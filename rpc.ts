import { Rpc } from "@opencode/plugin/rpc"

const task = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "done"],
  properties: { id: { type: "string" }, title: { type: "string" }, done: { type: "boolean" } },
} as const

export const BoardRpc = Rpc.define({
  id: "openspec-board",
  methods: {
    read: {
      input: {
        type: "object",
        properties: { refresh: { type: "boolean" } },
        additionalProperties: false,
      },
      output: {
        anyOf: [
          ...["no-openspec", "no-changes"].map((kind) => ({
            type: "object" as const,
            properties: { kind: { const: kind } },
            required: ["kind"],
            additionalProperties: false,
          })),
          {
            type: "object",
            properties: { kind: { const: "unresolved" }, message: { type: "string" } },
            required: ["kind", "message"],
            additionalProperties: false,
          },
          {
            type: "object",
            required: ["kind", "changes", "done", "total"],
            additionalProperties: false,
            properties: {
              kind: { const: "ready" },
              done: { type: "number" },
              total: { type: "number" },
              changes: {
                type: "array",
                items: {
                  type: "object",
                  required: ["name", "tasks", "done", "total", "mtime"],
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    tasks: { type: "array", items: task },
                    next: task,
                    done: { type: "number" },
                    total: { type: "number" },
                    mtime: { type: "number" },
                  },
                },
              },
            },
          },
        ],
      },
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: { workspaceID: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
})
