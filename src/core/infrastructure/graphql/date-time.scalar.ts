import { GraphQLISODateTime } from '@nestjs/graphql';

/**
 * Patches GraphQLISODateTime.serialize to accept ISO strings in addition to
 * Date objects. The built-in implementation returns null for strings, which
 * breaks when cached data is deserialized from Redis (JSON.stringify converts
 * Dates to ISO strings, so the cache returns strings, not Date instances).
 */
(GraphQLISODateTime as any).serialize = function (value: unknown): string {
  if (value instanceof Date) {
    if (!isFinite(value.getTime())) {
      throw new TypeError('DateTime cannot serialize an invalid Date');
    }
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    if (isFinite(d.getTime())) return d.toISOString();
  }
  if (typeof value === 'number') {
    const d = new Date(value);
    if (isFinite(d.getTime())) return d.toISOString();
  }
  throw new TypeError(`DateTime cannot serialize value: ${JSON.stringify(value)}`);
};
