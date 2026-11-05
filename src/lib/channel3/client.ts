import { Channel3 } from "@channel3/sdk";
import { normalizeProduct, type ProductCard, type RawProduct } from "./normalize";

export type SearchOptions = {
  query: string;
  limit?: number;
  currency?: string;
  minCents?: number;
  maxCents?: number;
};

export interface Channel3Gateway {
  /** Costs 1 credit. Call only through the budget guard in lib/catalogue. */
  search(opts: SearchOptions): Promise<ProductCard[]>;
  /** GET /v1/products/{id}. Free. Used for all monitoring. */
  retrieve(id: string, currency?: string): Promise<ProductCard>;
}

type Currency = NonNullable<Parameters<Channel3["products"]["retrieve"]>[0]["currency"]>;

export function createChannel3Gateway(apiKey: string): Channel3Gateway {
  const client = new Channel3({ apiKey });
  const options = { timeoutInSeconds: 8, maxRetries: 1 };
  return {
    async search({ query, limit = 12, currency, minCents, maxCents }) {
      const price =
        minCents !== undefined || maxCents !== undefined
          ? {
              ...(minCents !== undefined ? { min_price: minCents / 100 } : {}),
              ...(maxCents !== undefined ? { max_price: maxCents / 100 } : {}),
            }
          : undefined;
      const page = await client.products.search(
        {
          query,
          limit,
          ...(price ? { filters: { price } } : {}),
          ...(currency ? { config: { currency: currency as Currency } } : {}),
        },
        options,
      );
      return page.data.map((p) => normalizeProduct(p as RawProduct));
    },
    async retrieve(id, currency) {
      const product = await client.products.retrieve(
        { product_id: id, ...(currency ? { currency: currency as Currency } : {}) },
        options,
      );
      return normalizeProduct(product as RawProduct);
    },
  };
}
