// Shared types used by both the backend and the frontend.
export type Role = 'student' | 'staff' | 'admin';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  stallId: number | null; // only set for staff
}

export interface Session {
  userId: number;
  name: string;
  role: Role;
  stallId: number | null;
}

export interface Stall {
  id: number;
  name: string;
  location: string;
  description: string;
  isActive: boolean;
}

export interface Slot {
  id: number;
  stallId: number;
  start: string; // ISO timestamp
  end: string;
  capacity: number;
  booked: number;
}

export type OrderStatus = 'PLACED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
export const ORDER_STATUSES: OrderStatus[] = ['PLACED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'];

export interface OrderItem {
  menuItemId: string; // = MongoDB menu_items._id (hex string)
  name: string; // snapshot at order time
  unitPrice: number; // snapshot at order time
  quantity: number;
}

export interface Order {
  id: number;
  requestId: string;
  studentId: number;
  studentName?: string;
  stallId: number;
  stallName?: string;
  slotId: number;
  slotStart?: string;
  status: OrderStatus;
  totalAmount: number;
  createdAt: string;
  items: OrderItem[];
}

export interface StallLoad {
  stallId: number;
  activeOrders: number; // PLACED + PREPARING
  capacityNextHour: number; // sum of slot capacity in the next hour
  bookedNextHour: number;
}

export interface StallAvailability {
  stallId: number;
  totalItems: number;
  availableItems: number; // is_available AND stock > 0
}

export type Category = 'juice' | 'sandwich' | 'snack' | 'combo';
export const CATEGORIES: Category[] = ['juice', 'sandwich', 'snack', 'combo'];

export interface MenuItem {
  _id: string;
  stall_id: number;
  name: string;
  category: Category;
  description: string;
  price: number;
  is_available: boolean;
  stock: number;
  tags: string[];
  attributes: Record<string, unknown>;
}

export interface ForecastHour { hour: number; predicted_orders: number }
export interface StallForecast {
  stall_id: number;
  total_orders: number;
  peak_hour: number;
  hourly: ForecastHour[];
}
export interface Forecast {
  available: boolean;
  generated_at?: string;
  target_date?: string;
  model?: string;
  data_source?: 'synthetic' | 'real';
  note?: string;
  stalls: StallForecast[];
}
