import * as fs from "fs";
import { info } from "compiler-console";

interface JavascriptData {
  source: string;
  fileName: string;
}

interface CacheData {
  javascript: JavascriptData;
  sourceMapJson: string | undefined;
}
/**
 * Caches output from typescript on disk
 */
export class CompilerCache {
  constructor(private cacheRoot: string) {}

  public addJavascript(sourceFilePath: string, data: JavascriptData) {
    info(`Caching javascript for ${sourceFilePath}`);
  }
  public addSourceMap(sourceFilePath: string, data: string) {
    info(`Caching sourceMap for ${sourceFilePath}`);
  }
  public get(sourceFilePath: string): CacheData | undefined {
    return undefined;
  }
}
