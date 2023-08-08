import { promises as fs } from 'fs';
import { exec } from 'child_process';
import getFiles from 'node-recursive-directory';
import path from 'path';
import { schemaToTs } from './schemaToTs';
import _ from 'lodash';
import { Command } from 'commander';
import debug from 'debug';
const log = debug('contract-compiler');

type Args = {
  src: string;
  out: string;
  buildSchema: boolean;
};

const generate = async (argv: Args) => {
  log('argv', argv);
  const contractPath = argv.src;
  const outputDir = argv.out;
  const buildSchema = argv.buildSchema;
  const dir = path.join(process.cwd(), contractPath, '/contracts');
  const files = (await getFiles(dir)).filter((file) =>
    file.endsWith('Cargo.toml'),
  );
  const contracts: { dir: string; name: string }[] = await Promise.all(
    files.map(async (file) => {
      const dir = path.dirname(file);
      const name = await fs.readFile(file, 'utf8').then((data) => {
        const name = data.match(/name = "(.*)"/);
        if (name) {
          return name[1];
        }
        return '';
      });
      return {
        name,
        dir: dir,
      };
    }),
  );
  if (buildSchema) {
    for (const contract of contracts) {
      await new Promise((r, rj) =>
        exec('cargo schema', { cwd: contract.dir }, (err, stdout, stderr) => {
          if (err) {
            console.error(err);
            rj(err);
          } else {
            console.log(stdout);
            console.error(stderr);
            r(true);
          }
        }),
      );
    }
  }
  const contractsForCodegen = (
    await Promise.all(
      contracts.map(async (contract) => {
        //check if schema exists
        const schemaPath = path.join(
          contract.dir,
          `/schema/${contract.name}.json`,
        );
        const schemaExists = await fs
          .access(schemaPath)
          .then(() => true)
          .catch(() => false);
        return (
          schemaExists && {
            name: contract.name,
            filePath: schemaPath,
          }
        );
      }),
    )
  ).filter(Boolean);

  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all(
    contractsForCodegen.map(async (contract) => {
      try {
        await schemaToTs(contract.filePath, contract.name, outputDir);
      } catch (e) {
        console.error(`Error while processing ${contract.name}: ${e}`);
        console.error(e.stack);
      }
    }),
  );
  await fs.writeFile(
    path.join(outputDir, 'index.ts'),
    contractsForCodegen
      .map(
        (contract, i) =>
          `import * as _${i} from './${_.camelCase(contract.name)}';\n` +
          `export const ${_.upperFirst(_.camelCase(contract.name))} = _${i};\n`,
      )
      .join(`\n`),
  );
  console.log('🎉 Done!');
};

if (require.main !== module) {
  const program = new Command();
  program
    .requiredOption('-s, --src <path>', 'Path to contracts project')
    .requiredOption('-o, --out <path>', 'Path to output')
    .option('-b, --buildSchema', 'Build schema before codegen', false);

  program.parse();

  const argv = program.opts<Args>();
  generate(argv);
}
export { generate };
