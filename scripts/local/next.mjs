// Runs `next <command>` with the emulator's .env.local-stack. Development only.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

const env = { ...process.env, ...parse(readFileSync(".env.local-stack")) };
const bin = path.join("node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 1));
