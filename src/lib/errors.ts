export class McpToolError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "McpToolError";
  }
}

export type ErrorResult = {
  content: [{ type: "text"; text: string }];
  isError: true;
};

export function toErrorResult(err: unknown): ErrorResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}
