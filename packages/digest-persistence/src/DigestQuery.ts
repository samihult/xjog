/**
 * Example expression:
 *
 * const expression: Expression = {
 *   op: 'and',
 *   left: { op: 'eq', left: "name", right: 'Bob' },
 *   right: {
 *     op: 'or',
 *     left: {
 *       op: 'not',
 *       operand: { op: 'matches', left: 'birthday', right: '1982-\\d{2}-\\d{2}' }
 *     },
 *     right: {
 *       op: 'and',
 *       left: { op: '<=', left: 'itemQuantity', right: 99 },
 *       right: { op: 'before', dateTime: new Date() }
 *     }
 *   }
 * };
 */

export type PrimaryExpression =
  | {
      op: 'eq' | 'matches';
      left: string;
      right: string;
    }
  | {
      op: '<' | '<=' | '>' | '>=';
      left: string;
      right: number;
    }
  | {
      op:
        | 'updated before'
        | 'updated after'
        | 'created before'
        | 'created after';
      dateTime: Date;
    };

export type Expression =
  | PrimaryExpression
  | {
      op: 'and' | 'or';
      left: Expression;
      right: Expression;
    }
  | {
      op: 'not';
      operand: Expression;
    };

export type DigestQuery = {
  chartId?: string;
  machineId?: string;
  query: Expression;

  limit?: number;
  offset?: number;
  order?: 'ASC' | 'DESC';
};
