import { z } from "zod";
import type { ManyChatApi } from "./manychat-client.js";
import {
  channelSchema,
  evaluatePolicy,
  type InteractionEvidence,
  type Verdict,
} from "../policy/guard.js";

const id = z.number().int().positive().safe();
const text = z.string().min(1).max(4096);
const value = z.union([
  z.string().max(16384),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const intent = {
  subscriber_id: id,
  message_tag: z.string().max(64).optional(),
  promotional: z.boolean().optional(),
  human_agent: z.boolean().optional(),
};
const content = z
  .object({
    version: z.literal("v2"),
    content: z
      .object({
        messages: z
          .array(
            z.discriminatedUnion("type", [
              z.object({ type: z.literal("text"), text }),
              z.object({
                type: z.literal("image"),
                url: z.url().startsWith("https://"),
              }),
              z.object({
                type: z.literal("video"),
                url: z.url().startsWith("https://"),
              }),
              z.object({
                type: z.literal("audio"),
                url: z.url().startsWith("https://"),
              }),
            ]),
          )
          .min(1)
          .max(10),
      })
      .strict(),
  })
  .strict();
export interface Operation {
  description: string;
  schema: z.ZodObject;
  method?: "GET" | "POST";
  path?: string;
}
const read = (
  description: string,
  path: string,
  shape: z.ZodRawShape = {},
): Operation => ({
  description,
  path,
  method: "GET",
  schema: z.object(shape).strict(),
});
const write = (
  description: string,
  path: string,
  shape: z.ZodRawShape,
): Operation => ({
  description,
  path,
  method: "POST",
  schema: z.object(shape).strict(),
});
const contact = {
  first_name: text.optional(),
  last_name: text.optional(),
  phone: text.optional(),
  email: z.email().optional(),
  gender: text.optional(),
  has_opt_in_sms: z.boolean().optional(),
  has_opt_in_email: z.boolean().optional(),
  consent_phrase: text.optional(),
};
export const operations: Readonly<Record<string, Operation>> = {
  get_subscriber: read("Get a subscriber", "/subscriber/getInfo", {
    subscriber_id: id,
  }),
  find_subscriber_by_email: read(
    "Find a subscriber by email",
    "/subscriber/findBySystemField",
    { email: z.email() },
  ),
  find_subscriber_by_phone: read(
    "Find a subscriber by phone",
    "/subscriber/findBySystemField",
    { phone: text },
  ),
  find_subscriber_by_name: read(
    "Find subscribers by name",
    "/subscriber/findByName",
    { name: text },
  ),
  create_subscriber: {
    ...write(
      "Create a subscriber with consent",
      "/subscriber/createSubscriber",
      { ...contact, whatsapp_phone: text.optional() },
    ),
    schema: z
      .object({ ...contact, whatsapp_phone: text.optional() })
      .strict()
      .refine(
        (a) => !!(a.phone || a.whatsapp_phone || a.email),
        "At least one contact address is required",
      ),
  },
  update_subscriber: write(
    "Update subscriber contact details",
    "/subscriber/updateSubscriber",
    { subscriber_id: id, ...contact },
  ),
  list_tags: read("List tags", "/page/getTags"),
  create_tag: write("Create a tag", "/page/createTag", { name: text }),
  add_tag_to_subscriber: write("Add a subscriber tag", "/subscriber/addTag", {
    subscriber_id: id,
    tag_id: id,
  }),
  add_tag_to_subscriber_by_name: write(
    "Add a subscriber tag by name",
    "/subscriber/addTagByName",
    { subscriber_id: id, tag_name: text },
  ),
  remove_tag_from_subscriber: write(
    "Remove a subscriber tag",
    "/subscriber/removeTag",
    { subscriber_id: id, tag_id: id },
  ),
  remove_tag_from_subscriber_by_name: write(
    "Remove a subscriber tag by name",
    "/subscriber/removeTagByName",
    { subscriber_id: id, tag_name: text },
  ),
  list_custom_fields: read("List custom fields", "/page/getCustomFields"),
  create_custom_field: write(
    "Create a custom field",
    "/page/createCustomField",
    {
      caption: text,
      type: z.enum(["text", "number", "date", "datetime", "boolean"]),
      description: text.optional(),
    },
  ),
  set_custom_field: write(
    "Set a subscriber custom field",
    "/subscriber/setCustomField",
    { subscriber_id: id, field_id: id, field_value: value },
  ),
  set_custom_field_by_name: write(
    "Set a subscriber custom field by name",
    "/subscriber/setCustomFieldByName",
    { subscriber_id: id, field_name: text, field_value: value },
  ),
  set_custom_fields_bulk: write(
    "Set up to twenty subscriber fields",
    "/subscriber/setCustomFields",
    {
      subscriber_id: id,
      fields: z
        .array(
          z
            .object({
              field_id: id.optional(),
              field_name: text.optional(),
              field_value: value,
            })
            .strict()
            .refine(
              (a) => !!a.field_id !== !!a.field_name,
              "Exactly one field identifier required",
            ),
        )
        .min(1)
        .max(20),
    },
  ),
  list_flows: read("List automation flows", "/page/getFlows"),
  send_flow: {
    description:
      "Trigger a flow after the shared send guard; opaque flows cannot use HUMAN_AGENT",
    schema: z.object({ subscriber_id: id, flow_ns: text }).strict(),
  },
  send_text_message: {
    description: "Send text after the shared fail-closed Meta guard",
    schema: z.object({ ...intent, text }).strict(),
  },
  send_content: {
    description:
      "Send text/image/video/audio content after the shared fail-closed Meta guard",
    schema: z.object({ ...intent, data: content }).strict(),
  },
  validate_message: {
    description:
      "Check current authoritative subscriber evidence without sending. Caller-supplied channel/window are rejected.",
    schema: z.object(intent).strict(),
  },
  get_page_info: read("Get account page information", "/page/getInfo"),
  list_bot_fields: read("List bot fields", "/page/getBotFields"),
  set_bot_field: write("Set a page-wide bot field", "/page/setBotField", {
    field_id: id,
    field_value: value,
  }),
  list_growth_tools: read("List growth tools", "/page/getGrowthTools"),
  list_otn_topics: read(
    "List legacy One-Time Notification topics; availability depends on ManyChat",
    "/page/getOtnTopics",
  ),
  health_check: read(
    "Check ManyChat authentication using read-only page info",
    "/page/getInfo",
  ),
};
/** Trusted backend adapter only. No HTTP/CLI/MCP argument can install a provider. */
export interface EvidenceProvider {
  resolve(subscriberId: number): Promise<InteractionEvidence | null>;
}
const evidenceSchema = z
  .object({
    subscriberId: id,
    channel: channelSchema,
    lastUserInteractionAt: z.iso.datetime({ offset: true }),
    source: z.literal("verified-webhook"),
    adReferral: z
      .object({
        entryPoint: z.enum(["click-to-messenger", "click-to-direct"]),
        firstUserMessageAt: z.iso.datetime({ offset: true }),
        verified: z.literal(true),
      })
      .strict()
      .optional(),
  })
  .strict();
export class ExecutionEngine {
  constructor(
    private readonly client: ManyChatApi,
    private readonly evidence?: EvidenceProvider,
  ) {}
  async validate(
    subscriberId: number,
    args: {
      message_tag?: string;
      promotional?: boolean;
      human_agent?: boolean;
    },
  ): Promise<Verdict> {
    const deny = (code: string, message: string): Verdict => ({
      allowed: false,
      code,
      message,
      warnings: [],
    });
    let info: { id?: unknown; last_interaction?: unknown };
    let proof: InteractionEvidence | null | undefined;
    try {
      info = await this.client.get("/subscriber/getInfo", {
        subscriber_id: String(subscriberId),
      });
      proof = await this.evidence?.resolve(subscriberId);
    } catch {
      return deny(
        "EVIDENCE_UNAVAILABLE",
        "Could not retrieve authoritative subscriber evidence; no send was attempted.",
      );
    }
    if (!info || String(info.id) !== String(subscriberId))
      return deny(
        "SUBSCRIBER_MISMATCH",
        "Subscriber lookup did not return the requested identity.",
      );
    if (
      typeof info.last_interaction !== "string" ||
      !Number.isFinite(Date.parse(info.last_interaction))
    )
      return deny(
        "INTERACTION_UNKNOWN",
        "ManyChat did not return a usable last_interaction; no send was attempted.",
      );
    const parsed = evidenceSchema.safeParse(proof);
    if (
      !parsed.success ||
      parsed.data.subscriberId !== subscriberId ||
      Date.parse(parsed.data.lastUserInteractionAt) !==
        Date.parse(info.last_interaction)
    )
      return deny(
        "CHANNEL_UNKNOWN",
        "ManyChat getInfo does not identify the channel of its last interaction. Connected phone/Instagram identifiers do not prove it. Supply a trusted server-side evidence adapter; caller declarations cannot unlock sending.",
      );
    return evaluatePolicy(parsed.data, args);
  }
  async execute(name: string, input: unknown): Promise<unknown> {
    const op = operations[name];
    if (!op) throw new Error("Unknown operation.");
    const args = op.schema.parse(input) as Record<string, unknown>;
    if (name === "validate_message" || name.startsWith("send_")) {
      const verdict = await this.validate(args.subscriber_id as number, args);
      if (name === "validate_message") return verdict;
      if (!verdict.allowed) throw new PolicyError(verdict);
      // Out-of-wedge validation is not an assertion of sending API support.
      if (
        verdict.channel &&
        ["sms", "email", "telegram", "tiktok"].includes(verdict.channel)
      )
        throw new Error(
          "Sending on this channel is not supported by this execution adapter.",
        );
      if (name === "send_flow")
        return this.client.post("/sending/sendFlow", {
          subscriber_id: args.subscriber_id,
          flow_ns: args.flow_ns,
        });
      const data =
        name === "send_content"
          ? args.data
          : {
              version: "v2",
              content: { messages: [{ type: "text", text: args.text }] },
            };
      const body: Record<string, unknown> = {
        subscriber_id: args.subscriber_id,
        data,
      };
      if (args.message_tag) body.message_tag = args.message_tag;
      return {
        result: await this.client.post("/sending/sendContent", body),
        warnings: verdict.warnings,
      };
    }
    if (op.method === "GET")
      return this.client.get(
        op.path!,
        Object.fromEntries(
          Object.entries(args).map(([k, v]) => [k, String(v)]),
        ),
      );
    return this.client.post(op.path!, args);
  }
}
export class PolicyError extends Error {
  constructor(public readonly verdict: Verdict) {
    super(`${verdict.code}: ${verdict.message}`);
  }
}
