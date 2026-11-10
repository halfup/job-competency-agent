import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = ["package.json", "index.html", "styles.css", "app.js", "templates/roles.json", "scripts/build-check.mjs"];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error("缺少文件: " + file);
}
const roles = JSON.parse(fs.readFileSync(path.join(root, "templates/roles.json"), "utf8"));
if (!Array.isArray(roles) || roles.length !== 3) throw new Error("岗位模板数量应为 3");
for (const role of roles) {
  if (!role.id || !role.name || !Array.isArray(role.competencies) || role.competencies.length < 5 || !Array.isArray(role.questions) || role.questions.length !== 4) {
    throw new Error("岗位模板结构不完整: " + (role.id || "unknown"));
  }
}
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (!index.includes('id="app"')) throw new Error("index.html 缺少 app 根节点");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
if (!app.includes("templates/roles.json")) throw new Error("app.js 未加载岗位模板");
console.log("PASS build-check: 3 role templates, 4-stage flow, auditable report shell");
