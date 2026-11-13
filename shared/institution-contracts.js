import { z } from "zod";
import { roles } from "./contracts.js";
const email = z.email().max(200).transform(value => value.toLowerCase());
const text = z.string().trim().min(1).max(200);
export const workspaceLogin = z.object({ email, password: z.string().min(1).max(200), adminKey: z.string().trim().max(500).optional(), institutionId: z.string().max(100).optional(), workspaceCode: z.string().max(150).optional() }).strict();
export const workspaceRegistration = z.object({ name: text, email, password: z.string().min(12).max(200), adminKey: z.string().trim().max(500).optional(), institutionName: text.optional(), discoverable: z.boolean().default(false), invitationToken: z.string().max(200).optional() }).strict();
export const workspaceRename = z.object({ displayName: text, discoverable: z.boolean().optional() }).strict();
export const workspaceInvitation = z.object({ role: z.enum(roles).default("viewer"), email: email.optional(), permittedRoomIds: z.array(z.string().max(100)).max(100).default([]), expiresInHours: z.number().int().min(1).max(168).default(24) }).strict();
export const workspaceAccept = z.object({ email, password: z.string().min(1).max(200), invitationToken: z.string().min(30).max(200) }).strict();
