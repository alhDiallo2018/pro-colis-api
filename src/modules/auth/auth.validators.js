import { z } from 'zod';

const roleSchema = z.enum(['client', 'driver', 'admin', 'super_admin']);
const pinSchema = z.string().regex(/^\d{6}$/, 'Le code PIN doit contenir exactement 6 chiffres');

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email().optional().nullable(),
    phone: z.string().min(8),
    fullName: z.string().min(2),
    password: z.string().min(8).optional(),
    pin: pinSchema.optional(),
    role: roleSchema.default('client'),
    address: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    region: z.string().optional().nullable(),
    garageId: z.string().uuid().optional().nullable(),
    vehiclePlate: z.string().optional().nullable(),
    vehicleModel: z.string().optional().nullable(),
    vehicleColor: z.string().optional().nullable(),
    vehicleYear: z.coerce.number().int().optional().nullable()
  }),
  params: z.object({}).default({}),
  query: z.object({}).default({})
});

export const loginWithPinSchema = z.object({
  body: z.object({
    identifier: z.string().min(3),
    pin: pinSchema
  }),
  params: z.object({}).default({}),
  query: z.object({}).default({})
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(20)
  }),
  params: z.object({}).default({}),
  query: z.object({}).default({})
});

export const sendOtpSchema = z.object({
  body: z.object({
    phone: z.string().min(8).optional(),
    email: z.string().email().optional(),
    purpose: z.enum(['verification', 'reset-pin', 'delivery', 'payment']).default('verification')
  }).refine((data) => data.phone || data.email, {
    message: 'Le numero de telephone ou l\'email est requis'
  }),
  params: z.object({}).default({}),
  query: z.object({}).default({})
});

export const verifyOtpSchema = z.object({
  body: z.object({
    phone: z.string().min(8).optional(),
    email: z.string().email().optional(),
    code: z.string().min(4).max(10),
    purpose: z.enum(['verification', 'reset-pin', 'delivery', 'payment']).default('verification')
  }).refine((data) => data.phone || data.email, {
    message: 'Le numero de telephone ou l\'email est requis'
  }),
  params: z.object({}).default({}),
  query: z.object({}).default({})
});
