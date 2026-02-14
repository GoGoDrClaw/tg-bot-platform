import path from "path";
import Module from "module";

type AliasMap = Record<string, string>;

const resolvedTargets: AliasMap = {
  "@": path.resolve(__dirname),
};

const originalResolve: any = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
  for (const [alias, target] of Object.entries(resolvedTargets)) {
    if (request === alias || request.startsWith(`${alias}/`)) {
      const rest = request.slice(alias.length);
      const full = path.join(target, rest);
      return originalResolve.call(this, full, parent, isMain, options);
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};
