import { Plugin } from '@nestjs/apollo';
import { Logger } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import {
  fieldExtensionsEstimator,
  getComplexity,
  simpleEstimator,
} from 'graphql-query-complexity';

/**
 * Rejects GraphQL operations whose computed complexity exceeds MAX_QUERY_COMPLEXITY (default: 100).
 *
 * Complexity is calculated per-field:
 *   - Fields decorated with `@Field({ complexity: N })` use N as their cost.
 *   - All other fields default to 1.
 *
 * Raise the cost of list resolvers to prevent abuse, e.g.:
 *   @Field(() => [User], { complexity: (opts) => 10 + opts.childComplexity * opts.args.limit })
 */
@Plugin()
export class QueryComplexityPlugin {
  private readonly logger = new Logger(QueryComplexityPlugin.name);
  private readonly maxComplexity: number;

  constructor() {
    this.maxComplexity = parseInt(
      process.env.MAX_QUERY_COMPLEXITY ?? '300',
      10,
    );
  }

  async requestDidStart() {
    const { maxComplexity, logger } = this;

    return {
      async didResolveOperation({ request, document, schema }: any) {
        const complexity = getComplexity({
          schema,
          operationName: request.operationName,
          query: document,
          variables: request.variables,
          estimators: [
            fieldExtensionsEstimator(),
            simpleEstimator({ defaultComplexity: 1 }),
          ],
        });

        logger.debug(
          `[${request.operationName ?? 'anonymous'}] complexity: ${complexity}/${maxComplexity}`,
        );

        if (complexity > maxComplexity) {
          throw new GraphQLError(
            `Query too complex: ${complexity}. Maximum allowed: ${maxComplexity}.`,
            {
              extensions: {
                code: 'QUERY_TOO_COMPLEX',
                statusCode: 400,
                complexity,
                maxComplexity,
              },
            },
          );
        }
      },
    };
  }
}
