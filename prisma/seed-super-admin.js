import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { logger } from '../src/config/logger.js';
import { disconnectPrisma, prisma } from '../src/config/prisma.js';

const weakPins = new Set([
  '000000',
  '111111',
  '222222',
  '333333',
  '444444',
  '555555',
  '666666',
  '777777',
  '888888',
  '999999',
  '123456',
  '654321'
]);

const superAdminSchema = z.object({
  fullName: z.string().trim().min(2, 'le nom complet doit contenir au moins 2 caractères'),
  email: z.string().trim().toLowerCase().email('adresse email invalide'),
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'le téléphone doit être au format international, par exemple +221771234567'),
  pin: z.string().regex(/^\d{6}$/, 'le PIN doit contenir exactement 6 chiffres'),
  password: z.string().min(12, 'le mot de passe doit contenir au moins 12 caractères')
}).superRefine((profile, context) => {
  if (weakPins.has(profile.pin)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pin'],
      message: 'ce PIN est trop facile à deviner'
    });
  }

  if (profile.password.includes(profile.pin)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['password'],
      message: 'le mot de passe ne doit pas contenir le PIN'
    });
  }
});

function readProfileFromEnvironment() {
  const parsed = superAdminSchema.safeParse({
    fullName: process.env.PROCOLIS_SUPERADMIN_FULL_NAME,
    email: process.env.PROCOLIS_SUPERADMIN_EMAIL,
    phone: process.env.PROCOLIS_SUPERADMIN_PHONE,
    pin: process.env.PROCOLIS_SUPERADMIN_PIN,
    password: process.env.PROCOLIS_SUPERADMIN_PASSWORD
  });

  if (!parsed.success) {
    // Les valeurs reçues ne sont jamais incluses dans l'erreur afin de ne pas
    // exposer le PIN ou le mot de passe dans les logs de production.
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'configuration'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuration du super-admin invalide — ${details}`);
  }

  return parsed.data;
}

async function upsertSuperAdmin(profile) {
  const [passwordHash, pinHash] = await Promise.all([
    bcrypt.hash(profile.password, 12),
    bcrypt.hash(profile.pin, 12)
  ]);

  return prisma.$transaction(async (tx) => {
    // Une recherche sur les deux identifiants empêche d'écraser deux comptes
    // distincts si l'email et le téléphone existent déjà séparément.
    const matchingUsers = await tx.user.findMany({
      where: {
        OR: [{ email: profile.email }, { phone: profile.phone }]
      },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        role: true,
        status: true
      }
    });

    if (matchingUsers.length > 1) {
      throw new Error(
        'Conflit détecté : l\'email et le téléphone appartiennent à deux comptes différents'
      );
    }

    const existingUser = matchingUsers[0];
    if (existingUser && existingUser.role !== 'super_admin') {
      // Le seed ne doit jamais élever implicitement les privilèges d'un client,
      // chauffeur ou administrateur de garage existant.
      throw new Error(
        `Création refusée : un compte de rôle "${existingUser.role}" utilise déjà cet email ou ce téléphone`
      );
    }

    // Préparer les données de l'utilisateur
    const userData = {
      email: profile.email,
      phone: profile.phone,
      fullName: profile.fullName,
      passwordHash,
      pinHash,
      role: 'super_admin',
      status: 'active',
      garageId: null,
      driverStatus: null,
      isEmailVerified: true,
      isPhoneVerified: true,
      isProfileComplete: true,
      deletedAt: null
    };

    // Créer ou mettre à jour l'utilisateur
    let user;
    if (existingUser) {
      user = await tx.user.update({
        where: { id: existingUser.id },
        data: userData
      });
    } else {
      user = await tx.user.create({ 
        data: {
          ...userData,
          // Le schema Prisma génère un UUID automatiquement si on ne le spécifie pas
          // Mais on peut aussi en générer un manuellement si besoin
        }
      });
    }

    // Plusieurs écrans supposent la présence d'un score. L'upsert garantit
    // cette relation sans modifier les éventuels points d'un compte existant.
    await tx.score.upsert({
      where: { userId: user.id },
      update: { 
        points: 0,
        totalEarned: 0,
        totalSpent: 0,
        lastUpdated: new Date() 
      },
      create: { 
        userId: user.id, 
        points: 0, 
        totalEarned: 0,
        totalSpent: 0,
        lastUpdated: new Date()
      }
    });

    // Journaliser l'action
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        actorRole: 'super_admin',
        action: existingUser ? 'seed.super_admin.update' : 'seed.super_admin.create',
        entityType: 'user',
        entityId: user.id,
        beforeData: existingUser
          ? {
              email: existingUser.email,
              phone: existingUser.phone,
              fullName: existingUser.fullName,
              role: existingUser.role,
              status: existingUser.status
            }
          : null,
        afterData: {
          email: user.email,
          phone: user.phone,
          fullName: user.fullName,
          role: user.role,
          status: user.status
        }
      }
    });

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      operation: existingUser ? 'updated' : 'created'
    };
  });
}

async function main() {
  const profile = readProfileFromEnvironment();
  const result = await upsertSuperAdmin(profile);

  logger.info(
    {
      userId: result.id,
      email: result.email,
      phone: result.phone,
      operation: result.operation
    },
    'Super-admin seed completed'
  );

  // Afficher les informations de connexion
  console.log('\n✅ Super-admin créé avec succès !');
  console.log('📧 Email:', profile.email);
  console.log('📱 Téléphone:', profile.phone);
  console.log('🔑 PIN:', profile.pin);
  console.log('🔒 Mot de passe:', profile.password);
  console.log('⚠️  Conservez ces identifiants dans un endroit sécurisé.\n');
}

try {
  await main();
} catch (error) {
  logger.error({ err: error }, 'Super-admin seed failed');
  console.error('\n❌ Erreur:', error.message);
  process.exitCode = 1;
} finally {
  await disconnectPrisma();
}