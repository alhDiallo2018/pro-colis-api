import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ids = {
  garageDakar: '11111111-1111-4111-8111-111111111111',
  garageThies: '22222222-2222-4222-8222-222222222222',
  customer: '33333333-3333-4333-8333-333333333333',
  driver: '44444444-4444-4444-8444-444444444444',
  vehicle: '55555555-5555-4555-8555-555555555555',
  addressHome: '66666666-6666-4666-8666-666666666661',
  addressOffice: '66666666-6666-4666-8666-666666666662',
  parcelDelivered: '77777777-7777-4777-8777-777777777771',
  parcelFree: '77777777-7777-4777-8777-777777777772',
  parcelTransit: '77777777-7777-4777-8777-777777777773',
  bidFree: '88888888-8888-4888-8888-888888888881',
  advertisement: '99999999-9999-4999-8999-999999999991',
  advertisementOffer: '99999999-9999-4999-8999-999999999992',
  paymentDelivered: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  scoreTxCustomer: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  scoreTxDriver: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  ratingDelivered: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  supportMessage: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  messageCustomer: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
  messageDriver: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
  driverLocation: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
  superAdmin: '33333333-3333-4333-8333-333333333334',
  adminGarage: '33333333-3333-4333-8333-333333333335'
};

const seedProfiles = [
  {
    id: ids.customer,
    email: 'customer@procolis.test',
    phone: '+221770000101',
    fullName: 'Customer Test',
    role: 'client',
    address: 'Plateau',
    city: 'Dakar',
    region: 'Dakar',
    pin: '123456',
    password: 'Password123!'
  },
  {
    id: ids.driver,
    email: 'driver@procolis.test',
    phone: '+221770000202',
    fullName: 'Driver Test',
    role: 'driver',
    address: 'Medina',
    city: 'Dakar',
    region: 'Dakar',
    pin: '123456',
    password: 'Password123!',
    driverStatus: 'available'
  },
  {
    id: ids.superAdmin,
    email: 'admin@procolis.test',
    phone: '+221770000303',
    fullName: 'Super Admin',
    role: 'super_admin',
    address: 'Centre-ville',
    city: 'Dakar',
    region: 'Dakar',
    pin: '123456',
    password: 'Password123!'
  },
  {
    id: ids.adminGarage,
    email: 'garage@procolis.test',
    phone: '+221770000404',
    fullName: 'Admin Garage Dakar',
    role: 'admin',
    address: 'Route de Rufisque',
    city: 'Dakar',
    region: 'Dakar',
    garageId: ids.garageDakar,
    pin: '123456',
    password: 'Password123!'
  }
];

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

async function upsertScore(tx, userId, points = 0) {
  await tx.score.upsert({
    where: { userId },
    update: { points, totalEarned: points, lastUpdated: new Date() },
    create: { userId, points, totalEarned: points }
  });
}

async function seedGarages() {
  const dakar = await prisma.garage.upsert({
    where: { id: ids.garageDakar },
    update: {
      name: 'Garage Dakar Test',
      city: 'Dakar',
      region: 'Dakar',
      address: 'Route de Rufisque',
      phone: '+221338000000',
      latitude: '14.7167',
      longitude: '-17.4677',
      isActive: true
    },
    create: {
      id: ids.garageDakar,
      name: 'Garage Dakar Test',
      city: 'Dakar',
      region: 'Dakar',
      address: 'Route de Rufisque',
      phone: '+221338000000',
      latitude: '14.7167',
      longitude: '-17.4677',
      isActive: true
    }
  });

  const thies = await prisma.garage.upsert({
    where: { id: ids.garageThies },
    update: {
      name: 'Garage Thies Test',
      city: 'Thies',
      region: 'Thies',
      address: 'Avenue Caen',
      phone: '+221339000000',
      latitude: '14.7910',
      longitude: '-16.9359',
      isActive: true
    },
    create: {
      id: ids.garageThies,
      name: 'Garage Thies Test',
      city: 'Thies',
      region: 'Thies',
      address: 'Avenue Caen',
      phone: '+221339000000',
      latitude: '14.7910',
      longitude: '-16.9359',
      isActive: true
    }
  });

  return { dakar, thies };
}

async function seedUsers(garage) {
  const users = {};

  for (const profile of seedProfiles) {
    const passwordHash = await bcrypt.hash(profile.password, 12);
    const pinHash = await bcrypt.hash(profile.pin, 12);

    // User, score and audit rows are kept together so repeated seeds stay coherent.
    users[profile.role] = await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { phone: profile.phone },
        update: {
          email: profile.email,
          fullName: profile.fullName,
          passwordHash,
          pinHash,
          role: profile.role,
          status: 'active',
          address: profile.address,
          city: profile.city,
          region: profile.region,
          garageId: profile.garageId ?? (profile.role === 'driver' || profile.role === 'admin' ? garage.id : null),
          driverStatus: profile.driverStatus || null,
          isEmailVerified: true,
          isPhoneVerified: true,
          isProfileComplete: true
        },
        create: {
          id: profile.id,
          email: profile.email,
          phone: profile.phone,
          fullName: profile.fullName,
          passwordHash,
          pinHash,
          role: profile.role,
          status: 'active',
          address: profile.address,
          city: profile.city,
          region: profile.region,
          garageId: profile.garageId ?? (profile.role === 'driver' || profile.role === 'admin' ? garage.id : null),
          driverStatus: profile.driverStatus || null,
          isEmailVerified: true,
          isPhoneVerified: true,
          isProfileComplete: true
        }
      });

      await upsertScore(tx, user.id, profile.role === 'driver' ? 120 : 80);
      return user;
    });
  }

  return {
    customer: users.client,
    driver: users.driver
  };
}

async function seedProfileUsage({ customer, driver, garages }) {
  await prisma.vehicle.upsert({
    where: { id: ids.vehicle },
    update: {
      plateNumber: 'DK-2026-PC',
      model: 'Renault Master',
      type: 'van',
      capacity: 1200,
      garageId: garages.dakar.id,
      driverId: driver.id,
      isAvailable: true
    },
    create: {
      id: ids.vehicle,
      plateNumber: 'DK-2026-PC',
      model: 'Renault Master',
      type: 'van',
      capacity: 1200,
      garageId: garages.dakar.id,
      driverId: driver.id,
      isAvailable: true
    }
  });

  await prisma.address.upsert({
    where: { id: ids.addressHome },
    update: {
      userId: customer.id,
      label: 'Maison',
      address: 'Plateau, Dakar',
      city: 'Dakar',
      region: 'Dakar',
      latitude: '14.6670',
      longitude: '-17.4350',
      isDefault: true
    },
    create: {
      id: ids.addressHome,
      userId: customer.id,
      label: 'Maison',
      address: 'Plateau, Dakar',
      city: 'Dakar',
      region: 'Dakar',
      latitude: '14.6670',
      longitude: '-17.4350',
      isDefault: true
    }
  });

  await prisma.address.upsert({
    where: { id: ids.addressOffice },
    update: {
      userId: customer.id,
      label: 'Bureau',
      address: 'Almadies, Dakar',
      city: 'Dakar',
      region: 'Dakar',
      latitude: '14.7422',
      longitude: '-17.5211',
      isDefault: false
    },
    create: {
      id: ids.addressOffice,
      userId: customer.id,
      label: 'Bureau',
      address: 'Almadies, Dakar',
      city: 'Dakar',
      region: 'Dakar',
      latitude: '14.7422',
      longitude: '-17.5211',
      isDefault: false
    }
  });

  // These parcels simulate the main screens: delivered history, free bidding and active delivery.
  await prisma.parcel.upsert({
    where: { id: ids.parcelDelivered },
    update: {
      status: 'delivered',
      driverId: driver.id,
      paymentStatus: 'completed',
      deliveryDate: daysAgo(1)
    },
    create: {
      id: ids.parcelDelivered,
      trackingNumber: 'PC-20260628-SEED01',
      senderId: customer.id,
      senderName: customer.fullName,
      senderPhone: customer.phone,
      senderEmail: customer.email,
      receiverName: 'Mamadou Fall',
      receiverPhone: '+221770000303',
      receiverEmail: 'mamadou@example.test',
      receiverAddress: 'Thies centre',
      description: 'Documents administratifs',
      weight: '1.20',
      type: 'document',
      status: 'delivered',
      departureGarageId: garages.dakar.id,
      arrivalGarageId: garages.thies.id,
      driverId: driver.id,
      price: '2500.00',
      deliveryFees: '500.00',
      totalAmount: '3000.00',
      paymentMethod: 'wave',
      paymentPhoneNumber: customer.phone,
      paymentStatus: 'completed',
      notes: 'Livraison terminee sans incident',
      pickupDate: daysAgo(3),
      deliveryDate: daysAgo(1),
      estimatedDeliveryDate: daysAgo(1),
      createdBy: customer.id
    }
  });

  await prisma.parcel.upsert({
    where: { id: ids.parcelFree },
    update: {
      status: 'free',
      isFreeForBidding: true,
      selectedBidId: null
    },
    create: {
      id: ids.parcelFree,
      trackingNumber: 'PC-20260628-SEED02',
      senderId: customer.id,
      senderName: customer.fullName,
      senderPhone: customer.phone,
      senderEmail: customer.email,
      receiverName: 'Aissatou Ndiaye',
      receiverPhone: '+221770000404',
      receiverAddress: 'Mbour',
      description: 'Petit colis fragile',
      weight: '3.50',
      type: 'fragile',
      status: 'free',
      departureGarageId: garages.dakar.id,
      arrivalGarageId: garages.thies.id,
      proposedPrice: '4500.00',
      totalAmount: '4500.00',
      isInsured: true,
      insuranceAmount: '1000.00',
      isFreeForBidding: true,
      notes: 'Le client attend des offres chauffeur',
      createdBy: customer.id
    }
  });

  await prisma.parcel.upsert({
    where: { id: ids.parcelTransit },
    update: {
      status: 'in_transit',
      driverId: driver.id
    },
    create: {
      id: ids.parcelTransit,
      trackingNumber: 'PC-20260628-SEED03',
      senderId: customer.id,
      senderName: customer.fullName,
      senderPhone: customer.phone,
      receiverName: 'Cheikh Ba',
      receiverPhone: '+221770000505',
      receiverAddress: 'Touba',
      description: 'Vetements et accessoires',
      weight: '7.00',
      type: 'package',
      status: 'in_transit',
      departureGarageId: garages.dakar.id,
      arrivalGarageId: garages.thies.id,
      driverId: driver.id,
      price: '6000.00',
      deliveryFees: '1000.00',
      totalAmount: '7000.00',
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      pickupDate: daysAgo(1),
      estimatedDeliveryDate: new Date(),
      createdBy: customer.id
    }
  });

  await prisma.bid.upsert({
    where: { id: ids.bidFree },
    update: {
      parcelId: ids.parcelFree,
      driverId: driver.id,
      price: '4200.00',
      message: 'Je peux prendre ce colis aujourd hui.',
      status: 'pending'
    },
    create: {
      id: ids.bidFree,
      parcelId: ids.parcelFree,
      driverId: driver.id,
      price: '4200.00',
      message: 'Je peux prendre ce colis aujourd hui.',
      status: 'pending'
    }
  });

  const eventRows = [
    {
      id: '12121212-1212-4121-8121-121212121211',
      parcelId: ids.parcelDelivered,
      status: 'pending',
      description: 'Colis cree par le client',
      userId: customer.id,
      userName: customer.fullName,
      userRole: customer.role,
      createdAt: daysAgo(4)
    },
    {
      id: '12121212-1212-4121-8121-121212121212',
      parcelId: ids.parcelDelivered,
      status: 'picked_up',
      description: 'Colis pris en charge par le chauffeur',
      location: 'Garage Dakar Test',
      userId: driver.id,
      userName: driver.fullName,
      userRole: driver.role,
      createdAt: daysAgo(3)
    },
    {
      id: '12121212-1212-4121-8121-121212121213',
      parcelId: ids.parcelDelivered,
      status: 'delivered',
      description: 'Colis livre au destinataire',
      location: 'Thies centre',
      userId: driver.id,
      userName: driver.fullName,
      userRole: driver.role,
      createdAt: daysAgo(1)
    },
    {
      id: '12121212-1212-4121-8121-121212121214',
      parcelId: ids.parcelFree,
      status: 'free',
      description: 'Colis ouvert aux offres chauffeurs',
      userId: customer.id,
      userName: customer.fullName,
      userRole: customer.role,
      createdAt: daysAgo(1)
    },
    {
      id: '12121212-1212-4121-8121-121212121215',
      parcelId: ids.parcelTransit,
      status: 'in_transit',
      description: 'Le colis est en route vers le garage destination',
      location: 'Autoroute Dakar-Thies',
      userId: driver.id,
      userName: driver.fullName,
      userRole: driver.role,
      createdAt: new Date()
    }
  ];

  await prisma.parcelEvent.createMany({
    data: eventRows,
    skipDuplicates: true
  });

  await prisma.payment.upsert({
    where: { id: ids.paymentDelivered },
    update: {
      userId: customer.id,
      parcelId: ids.parcelDelivered,
      amount: '3000.00',
      status: 'completed',
      completedAt: daysAgo(1)
    },
    create: {
      id: ids.paymentDelivered,
      userId: customer.id,
      parcelId: ids.parcelDelivered,
      amount: '3000.00',
      method: 'wave',
      status: 'completed',
      transactionId: 'WAVE-SEED-0001',
      phoneNumber: customer.phone,
      reference: 'PAY-SEED-0001',
      validatedBy: driver.id,
      validatedAt: daysAgo(1),
      completedAt: daysAgo(1)
    }
  });

  await prisma.advertisement.upsert({
    where: { id: ids.advertisement },
    update: {
      driverId: driver.id,
      status: 'open',
      availableWeight: '120.00',
      proposedPrice: '5000.00'
    },
    create: {
      id: ids.advertisement,
      driverId: driver.id,
      departureGarageId: garages.dakar.id,
      arrivalGarageId: garages.thies.id,
      departureCity: 'Dakar',
      arrivalCity: 'Thies',
      departureAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      availableWeight: '120.00',
      proposedPrice: '5000.00',
      description: 'Trajet disponible demain matin pour colis moyens.',
      status: 'open',
      metadata: { vehiclePlate: 'DK-2026-PC' }
    }
  });

  await prisma.advertisementOffer.upsert({
    where: { id: ids.advertisementOffer },
    update: {
      advertisementId: ids.advertisement,
      clientId: customer.id,
      parcelId: ids.parcelFree,
      price: '4800.00',
      status: 'pending'
    },
    create: {
      id: ids.advertisementOffer,
      advertisementId: ids.advertisement,
      clientId: customer.id,
      parcelId: ids.parcelFree,
      price: '4800.00',
      message: 'Pouvez-vous prendre le colis fragile ?',
      status: 'pending'
    }
  });

  await prisma.driverLocation.upsert({
    where: { id: ids.driverLocation },
    update: {
      driverId: driver.id,
      parcelId: ids.parcelTransit,
      latitude: '14.7800',
      longitude: '-17.1000',
      accuracy: '12.50'
    },
    create: {
      id: ids.driverLocation,
      driverId: driver.id,
      parcelId: ids.parcelTransit,
      latitude: '14.7800',
      longitude: '-17.1000',
      accuracy: '12.50'
    }
  });

  await prisma.rating.upsert({
    where: { id: ids.ratingDelivered },
    update: {
      parcelId: ids.parcelDelivered,
      driverId: driver.id,
      ratedBy: customer.id,
      rating: 5,
      comment: 'Livraison rapide et chauffeur professionnel.'
    },
    create: {
      id: ids.ratingDelivered,
      parcelId: ids.parcelDelivered,
      driverId: driver.id,
      ratedBy: customer.id,
      rating: 5,
      comment: 'Livraison rapide et chauffeur professionnel.'
    }
  });

  await prisma.supportMessage.upsert({
    where: { id: ids.supportMessage },
    update: {
      userId: customer.id,
      subject: 'Question sur une livraison',
      message: 'Je souhaite confirmer les horaires de livraison.',
      status: 'open'
    },
    create: {
      id: ids.supportMessage,
      userId: customer.id,
      subject: 'Question sur une livraison',
      message: 'Je souhaite confirmer les horaires de livraison.',
      status: 'open'
    }
  });

  await prisma.message.upsert({
    where: { id: ids.messageCustomer },
    update: {
      senderId: customer.id,
      receiverId: driver.id,
      parcelId: ids.parcelTransit,
      body: 'Bonjour, le colis est-il deja en route ?',
      isRead: true,
      readAt: new Date()
    },
    create: {
      id: ids.messageCustomer,
      senderId: customer.id,
      receiverId: driver.id,
      parcelId: ids.parcelTransit,
      body: 'Bonjour, le colis est-il deja en route ?',
      isRead: true,
      readAt: new Date()
    }
  });

  await prisma.message.upsert({
    where: { id: ids.messageDriver },
    update: {
      senderId: driver.id,
      receiverId: customer.id,
      parcelId: ids.parcelTransit,
      body: 'Oui, je suis actuellement sur la route de Thies.',
      isRead: false
    },
    create: {
      id: ids.messageDriver,
      senderId: driver.id,
      receiverId: customer.id,
      parcelId: ids.parcelTransit,
      body: 'Oui, je suis actuellement sur la route de Thies.',
      isRead: false
    }
  });

  await prisma.scoreTransaction.createMany({
    data: [
      {
        id: ids.scoreTxCustomer,
        userId: customer.id,
        amount: 80,
        type: 'delivery_reward',
        parcelId: ids.parcelDelivered,
        description: 'Points client pour livraison terminee'
      },
      {
        id: ids.scoreTxDriver,
        userId: driver.id,
        amount: 120,
        type: 'driver_delivery_reward',
        parcelId: ids.parcelDelivered,
        description: 'Points chauffeur pour livraison terminee'
      }
    ],
    skipDuplicates: true
  });

  await prisma.notification.createMany({
    data: [
      {
        id: 'abababab-abab-4aba-8aba-ababababab01',
        userId: customer.id,
        parcelId: ids.parcelDelivered,
        senderId: driver.id,
        senderName: driver.fullName,
        type: 'delivery_confirmed',
        title: 'Colis livre',
        body: 'Votre colis PC-20260628-SEED01 a ete livre.',
        data: { trackingNumber: 'PC-20260628-SEED01', status: 'delivered' },
        isRead: true,
        priority: 'normal'
      },
      {
        id: 'abababab-abab-4aba-8aba-ababababab02',
        userId: customer.id,
        parcelId: ids.parcelFree,
        bidId: ids.bidFree,
        senderId: driver.id,
        senderName: driver.fullName,
        type: 'bid_created',
        title: 'Nouvelle offre chauffeur',
        body: 'Driver Test propose 4200 XOF pour votre colis.',
        data: { price: 4200, parcelId: ids.parcelFree },
        isRead: false,
        priority: 'high'
      },
      {
        id: 'abababab-abab-4aba-8aba-ababababab03',
        userId: driver.id,
        parcelId: ids.parcelTransit,
        senderId: customer.id,
        senderName: customer.fullName,
        type: 'parcel_status',
        title: 'Colis en transit',
        body: 'Le colis PC-20260628-SEED03 est en transit.',
        data: { trackingNumber: 'PC-20260628-SEED03', status: 'in_transit' },
        isRead: false,
        priority: 'normal'
      }
    ],
    skipDuplicates: true
  });

  await prisma.auditLog.createMany({
    data: [
      {
        id: 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcd01',
        actorId: customer.id,
        actorRole: customer.role,
        action: 'parcel.create',
        entityType: 'parcel',
        entityId: ids.parcelDelivered,
        afterData: { trackingNumber: 'PC-20260628-SEED01', status: 'delivered' }
      },
      {
        id: 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcd02',
        actorId: driver.id,
        actorRole: driver.role,
        action: 'parcel.status_update',
        entityType: 'parcel',
        entityId: ids.parcelTransit,
        afterData: { trackingNumber: 'PC-20260628-SEED03', status: 'in_transit' }
      },
      {
        id: 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcd03',
        actorId: driver.id,
        actorRole: driver.role,
        action: 'bid.create',
        entityType: 'bid',
        entityId: ids.bidFree,
        afterData: { price: 4200, status: 'pending' }
      }
    ],
    skipDuplicates: true
  });
}

async function main() {
  const garages = await seedGarages();
  const users = await seedUsers(garages.dakar);
  await seedProfileUsage({ ...users, garages });

  console.log('Seed completed');
  console.table(
    seedProfiles.map((profile) => ({
      role: profile.role,
      identifier: profile.email,
      phone: profile.phone,
      pin: profile.pin
    }))
  );
  console.table([
    { resource: 'deliveredParcel', trackingNumber: 'PC-20260628-SEED01' },
    { resource: 'freeParcelWithBid', trackingNumber: 'PC-20260628-SEED02' },
    { resource: 'activeParcel', trackingNumber: 'PC-20260628-SEED03' },
    { resource: 'driverAdvertisement', route: 'Dakar -> Thies' }
  ]);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
