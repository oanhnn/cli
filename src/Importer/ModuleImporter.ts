import vm from 'vm';
import path from 'path';
import fs from 'fs-extra';
import { transformSync } from 'esbuild';
import { inject, injectable } from 'inversify';
import { Binding, Bus, color, ExecutionError, getPackage, ImporterContract, Preset } from '@/exports';

@injectable()
export class ModuleImporter implements ImporterContract {
  @inject(Binding.Bus)
  protected bus!: Bus;

  async import(directory: string): Promise<Preset> {
    this.bus.debug(`Importing preset at ${color.magenta(directory)}.`);

    const script = fs.readFileSync(this.findConfiguration(directory)).toString();
    const sanitizedScript = this.removeSelfImportStatement(script);

    return await this.evaluateConfiguration(sanitizedScript);
  }

  /**
   * Finds the configuration file for the given directory.
   */
  protected findConfiguration(directory: string): string {
    const packagePath = path.join(directory, 'package.json');

    // Tries to find a specified configuration file in the package.json.
    // If there is a specified file that does not exist, we throw.
    // If there is no specified file, we try to guess it.
    if (fs.existsSync(packagePath)) {
      const { preset } = JSON.parse(fs.readFileSync(packagePath).toString());

      if (preset) {
        const presetPath = path.join(directory, preset);

        if (fs.statSync(presetPath).isFile()) {
          return presetPath;
        }

        throw new ExecutionError()
          .withMessage(`The specified configuration file does not exist (${color.magenta(presetPath)}).`)
          .withoutStack()
          .stopsExecution();
      }
    }

    // Tries to guess the configuration file. It can be in ./
    // or ./src, is named "preset" and can have a few extensions.
    const paths = ['preset', 'src/preset'];
    const extensions = ['ts', 'js', 'mjs', 'cjs'];
    const files: string[] = [];

    paths.forEach((file) => {
      extensions.forEach((extension) => {
        files.push(path.join(directory, `${file}.${extension}`));
      });
    });

    for (const file of files) {
      if (fs.existsSync(file)) {
        this.bus.debug(`Found preset file at ${color.underline(file)}.`);
        return file;
      }
    }

    throw new ExecutionError()
      .withMessage(`The configuration file could not be found (tried in ${color.magenta(directory)}).`)
      .withoutStack()
      .stopsExecution();
  }

  /**
   * Evaluates the configuration and returns the preset.
   */
  protected async evaluateConfiguration(script: string): Promise<Preset> {
    try {
      const context = vm.createContext({
        exports: {},
        require,
        module,
        Preset: new Preset(),
        color,
      });

      const { code } = transformSync(script, {
        loader: 'ts',
        format: 'cjs',
      });
      vm.runInContext(code, context);

      return context.Preset as Preset;
    } catch (error) {
      throw new ExecutionError() //
        .withMessage(`The preset could not be evaluated.`)
        .withCompleteStack(error)
        .stopsExecution();
    }
  }

  /**
   * Removes the import statement for this very package from the given script.
   */
  protected removeSelfImportStatement(script: string) {
    return script
      .split(/\r\n|\r|\n/)
      .filter((line) => {
        const lineImports = ['import', 'require'].some((statement) => line.includes(statement));
        const lineMentionsImportValue = [getPackage().name, 'color', '@/api', 'use-preset'].some((imp) => line.includes(imp));

        if (lineImports && lineMentionsImportValue) {
          return false;
        }

        return true;
      })
      .join('\n');
  }
}
