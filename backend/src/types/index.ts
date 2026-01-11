import { Request } from 'express';

// Shopify Customer types (full customer from /customers endpoint)
export interface ShopifyCustomerFull {
  id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
  default_address?: {
    id: number;
    phone: string | null;
    address1: string | null;
    city: string | null;
    province: string | null;
    country: string | null;
  };
}

export interface ShopifyCustomerResponse {
  customer: ShopifyCustomerFull;
}

// Shopify Order types (partial customer in order response)
export interface ShopifyCustomer {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string | null;
  default_address?: {
    phone?: string | null;
  };
}

export interface ShopifyAddress {
  phone?: string | null;
  address1?: string;
  city?: string;
  country?: string;
  first_name?: string;
  last_name?: string;
}

export interface ShopifyLineItem {
  id: number;
  title: string;
  quantity: number;
  product_id: number;
  variant_id: number;
}

export interface ShopifyOrder {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  created_at: string;
  customer?: ShopifyCustomer | null;
  billing_address?: ShopifyAddress | null;
  shipping_address?: ShopifyAddress | null;
  line_items: ShopifyLineItem[];
  note_attributes?: Array<{ name: string; value: string }>;
}

export interface ShopifyOrdersResponse {
  orders: ShopifyOrder[];
}

// Auth types
export interface AuthUser {
  orderId: number;
  orderNumber: string;
  mobile: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export interface OrderInfo {
  id: number;
  orderNumber: string;
  email: string;
  customerName: string;
  createdAt: string;
  lineItems: Array<{
    id: number;
    title: string;
    quantity: number;
    productId: number;
    variantId: number;
  }>;
}

export interface VerifyOrderResult {
  success: boolean;
  error?: string;
  order?: OrderInfo;
}

export interface JwtPayload {
  orderId: number;
  orderNumber: string;
  mobile: string;
}
