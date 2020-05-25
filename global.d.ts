import type { MeteorTypescriptCompilerImpl } from "./meteor-typescript-compiler";

declare global {
  var MeteorTypescriptCompiler: typeof MeteorTypescriptCompilerImpl;
  class BabelCompiler {
    constructor(extraFeatures: MeteorCompiler.BabelFeatures);
    public processOneFileForTarget(
      inputfile: MeteorCompiler.InputFile,
      /**
       * Can be used to provide the mutated source if you’ve done some pre-processing
       */
      source: string | undefined
    ): MeteorCompiler.AddJavaScriptOptions;
    public inferExtraBabelOptions(
      inputfile: MeteorCompiler.InputFile,
      babelOptions: any,
      cacheDeps: any
    ): boolean;
  }
}
