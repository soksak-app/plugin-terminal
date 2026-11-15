// Registers the resolve hook of the plugin API fixtures for the test process (node --import of the test script).
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
