import test from "node:test";
import assert from "node:assert/strict";
import { workspaceRegistration, buildingJoinCode, workspaceLogin } from "../shared/institution-contracts.js";
const input = { name: "Boundary", email: "boundary@example.test", password: "six123", confirmPassword: "six123", accountType: "viewer", joinCode: "Ab12Cd34" };
test("password minimum six and join-code minimum eight match the form rules", () => {
 assert.ok(workspaceRegistration.safeParse(input).success);
 assert.equal(workspaceRegistration.safeParse({ ...input, password: "five1", confirmPassword: "five1" }).success, false);
 assert.equal(buildingJoinCode.safeParse("Ab12Cd3").success, false);
 assert.equal(buildingJoinCode.safeParse("aaaaaaaa").success, false);
 assert.equal(workspaceRegistration.safeParse({ ...input, confirmPassword: "other1" }).success, false);
});
test("Administrator registration key is forbidden in Viewer registration and login", () => {
 assert.ok(workspaceRegistration.safeParse({ ...input, accountType: "administrator", institutionName: "New building", adminKey: "test-registration-key" }).success);
 assert.equal(workspaceRegistration.safeParse({ ...input, adminKey: "untrusted" }).success, false);
 assert.equal(workspaceLogin.safeParse({ email: input.email, password: input.password, adminKey: "untrusted" }).success, false);
});
