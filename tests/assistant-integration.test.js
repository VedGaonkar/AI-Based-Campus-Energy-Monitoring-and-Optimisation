import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { startDatabase } from "../scripts/database.mjs";
import { loadConfig } from "../backend/src/config.js";
import { createInstitutionApplication } from "../backend/src/workspaces/runtime.js";
let db, runtime, a, b;
const origin = "http://localhost:5173", password = randomBytes(18).toString("hex"), adminKey = randomBytes(18).toString("hex");
const write = (member, path, body) => member.agent.post(path).set("Origin", origin).set("X-CSRF-Token", member.csrf).send(body);
async function register(email, name) {
 const agent = request.agent(runtime.app), csrf = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
 const result = await write({agent,csrf},"/api/v1/auth/register",{name,email,password,confirmPassword:password,accountType:"administrator",institutionName:name,adminKey,joinCode:`Join-${randomBytes(12).toString("hex")}`}); assert.equal(result.status,201);
 return {agent,csrf:result.body.data.csrfToken,id:result.body.data.institution._id,user:result.body.data.user};
}
before(async()=>{
 db=await startDatabase();runtime=await createInstitutionApplication(loadConfig({NODE_ENV:"test",MONGODB_URI:db.getUri("embedded_assistant"),SESSION_SECRET:randomBytes(32).toString("hex"),SERVICE_INGEST_TOKEN:randomBytes(32).toString("hex"),ADMIN_INVITE_KEY:adminKey,FRONTEND_ORIGIN:origin,PUBLIC_APP_URL:"http://localhost:5000"}));
 await new Promise(r=>runtime.server.listen(0,"127.0.0.1",r)); a=await register("a@assistant.test","Alpha Building");b=await register("b@assistant.test","Beta Building");
 const realm=await runtime.directory.realm(b.id), account=await runtime.directory.Account.findById(a.user._id).select("+passwordHash").lean(); await runtime.directory.addMember(realm,account,{role:"viewer"});
});
after(async()=>{await runtime?.close();await db?.stop();});
test("same-origin assistant assets and session are authenticated, and relative URLs work under the mount",async()=>{
 assert.equal((await request(runtime.app).get("/assistant/chat")).status,401);
 const page=await a.agent.get("/assistant/chat?embedded=1").timeout(10000); assert.equal(page.status,200); assert.ok(page.text.includes('./chat.js')); assert.ok(page.text.includes('./chat.css'));
 assert.equal((await a.agent.get("/assistant/chat.js")).status,200);assert.equal((await a.agent.get("/assistant/chat.css")).status,200);
 const session=await a.agent.get("/assistant/api/session").timeout(10000);assert.equal(session.status,200);assert.equal(session.body.mode,"admin");assert.equal(session.body.user.id,`${a.id}:${a.user._id}`);
 const reply=await write(a,"/assistant/api/message",{message:"Show all rooms"}); assert.equal(reply.status,200);assert.equal(reply.body.reply.source,"database");
 assert.equal((await a.agent.post("/assistant/api/message").set("Origin","https://foreign.invalid").set("X-CSRF-Token",a.csrf).send({message:"help"})).status,403);
});
test("announcements, proposals and identity remain separated when one account changes building",async()=>{
 const proposed=await write(a,"/assistant/api/message",{message:"Send an alert to everyone that Alpha private notice"});assert.equal(proposed.status,200);assert.ok(proposed.body.reply.proposal);
 assert.equal((await write(a,"/assistant/api/confirm",{proposalId:proposed.body.reply.proposal.id})).status,200);
 assert.ok(JSON.stringify((await a.agent.get("/assistant/api/announcements")).body).includes("Alpha private notice"));assert.ok(!JSON.stringify((await b.agent.get("/assistant/api/announcements")).body).includes("Alpha private notice"));
 const switched=await write(a,"/api/v1/auth/select-workspace",{institutionId:b.id});assert.equal(switched.status,200);a.csrf=switched.body.data.csrfToken;
 const session=await a.agent.get("/assistant/api/session").timeout(10000);assert.equal(session.body.mode,"viewer");assert.equal(session.body.user.id,`${b.id}:${a.user._id}`);
 assert.ok(!JSON.stringify((await a.agent.get("/assistant/api/announcements")).body).includes("Alpha private notice"));assert.equal((await write(a,"/assistant/api/confirm",{proposalId:proposed.body.reply.proposal.id})).status,403);
});
test("website logout also revokes embedded assistant access",async()=>{
 assert.equal((await write(a,"/api/v1/auth/logout",{})).status,200);assert.equal((await a.agent.get("/assistant/api/session").timeout(10000)).status,401);
});
