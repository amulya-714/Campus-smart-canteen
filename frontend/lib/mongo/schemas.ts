/**
 * Menu item schemas.
 *
 * Two layers of protection (defence in depth):
 *   1. zod  -> validates in the API, gives friendly error messages.
 *   2. Mongo $jsonSchema validator -> the DATABASE itself rejects bad documents,
 *      even if someone inserts directly with mongosh.
 *
 * Each category has DIFFERENT attributes - this is the reason we use a document DB.
 *   juice    : size, sugar_level
 *   sandwich : bread_type, add_ons[], is_spicy, is_veg
 *   snack    : is_veg, portion
 *   combo    : combo_items[], is_veg
 */
import { z } from 'zod';

// ---------- zod (API-level) ----------
const base = {
  stall_id: z.number().int().positive(),
  name: z.string().trim().min(2).max(80),
  description: z.string().max(300).default(''),
  price: z.number().positive().max(5000),
  is_available: z.boolean().default(true), // staff's manual on/off switch
  stock: z.number().int().min(0).max(1000), // units left today
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
};

export const juiceSchema = z.object({
  ...base,
  category: z.literal('juice'),
  attributes: z.object({
    size: z.enum(['small', 'medium', 'large']),
    sugar_level: z.enum(['none', 'low', 'regular', 'high']),
  }),
});

export const sandwichSchema = z.object({
  ...base,
  category: z.literal('sandwich'),
  attributes: z.object({
    bread_type: z.enum(['white', 'brown', 'multigrain', 'focaccia']),
    add_ons: z.array(z.string().trim().min(1).max(30)).max(8),
    is_spicy: z.boolean(),
    is_veg: z.boolean(),
  }),
});

export const snackSchema = z.object({
  ...base,
  category: z.literal('snack'),
  attributes: z.object({
    is_veg: z.boolean(),
    portion: z.enum(['small', 'regular', 'large']),
  }),
});

export const comboSchema = z.object({
  ...base,
  category: z.literal('combo'),
  attributes: z.object({
    combo_items: z.array(z.string().trim().min(1).max(40)).min(2).max(8),
    is_veg: z.boolean(),
  }),
});

// A "discriminated union" picks the right schema by looking at `category`.
export const menuItemSchema = z.discriminatedUnion('category', [
  juiceSchema, sandwichSchema, snackSchema, comboSchema,
]);
export type MenuItemInput = z.infer<typeof menuItemSchema>;

// Fields staff may change on update. `category` and `stall_id` are fixed.
export const menuUpdateSchema = z.object({
  name: base.name.optional(),
  description: base.description.optional(),
  price: base.price.optional(),
  is_available: z.boolean().optional(),
  stock: base.stock.optional(),
  tags: base.tags.optional(),
  attributes: z.record(z.unknown()).optional(),
}).strict();

// ---------- Mongo $jsonSchema (database-level) ----------
const commonProps = {
  stall_id: { bsonType: 'number', minimum: 1 },
  name: { bsonType: 'string', minLength: 2, maxLength: 80 },
  description: { bsonType: 'string' },
  price: { bsonType: 'number', minimum: 0.01 },
  is_available: { bsonType: 'bool' },
  stock: { bsonType: 'number', minimum: 0 },
  tags: { bsonType: 'array', items: { bsonType: 'string' } },
  created_at: { bsonType: 'date' },
  updated_at: { bsonType: 'date' },
};
const commonRequired = [
  'stall_id', 'name', 'category', 'price', 'is_available', 'stock', 'attributes', 'created_at', 'updated_at',
];
const variant = (category: string, attrRequired: string[], attrProps: Record<string, unknown>) => ({
  bsonType: 'object',
  required: commonRequired,
  properties: {
    ...commonProps,
    _id: {},
    category: { enum: [category] },
    attributes: { bsonType: 'object', required: attrRequired, properties: attrProps },
  },
});

export const menuJsonSchema = {
  oneOf: [
    variant('juice', ['size', 'sugar_level'], {
      size: { enum: ['small', 'medium', 'large'] },
      sugar_level: { enum: ['none', 'low', 'regular', 'high'] },
    }),
    variant('sandwich', ['bread_type', 'add_ons', 'is_spicy', 'is_veg'], {
      bread_type: { enum: ['white', 'brown', 'multigrain', 'focaccia'] },
      add_ons: { bsonType: 'array', items: { bsonType: 'string' } },
      is_spicy: { bsonType: 'bool' },
      is_veg: { bsonType: 'bool' },
    }),
    variant('snack', ['is_veg', 'portion'], {
      is_veg: { bsonType: 'bool' },
      portion: { enum: ['small', 'regular', 'large'] },
    }),
    variant('combo', ['combo_items', 'is_veg'], {
      combo_items: { bsonType: 'array', minItems: 2, items: { bsonType: 'string' } },
      is_veg: { bsonType: 'bool' },
    }),
  ],
};
