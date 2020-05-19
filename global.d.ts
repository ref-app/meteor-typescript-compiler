import type { MeteorTypescriptCompilerImpl } from "./meteor-typescript-compiler";

declare global {
  var MeteorTypescriptCompiler: typeof MeteorTypescriptCompilerImpl;
}
