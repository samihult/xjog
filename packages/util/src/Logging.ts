/**
 * Fields that will be present in every trace callback payload
 */
export type RequiredLogFields = {
  /** Correlation id */
  cid: string;
  /** Component */
  component: string;
  /** Function */
  in: string;
  /** Log level */
  level: number;
};

/**
 * Trace payload type for use in the classes
 * @group Debug
 */
export type LogFields = Record<string, any> & RequiredLogFields;
