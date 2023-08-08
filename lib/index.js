"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generate = void 0;
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const node_recursive_directory_1 = __importDefault(require("node-recursive-directory"));
const path_1 = __importDefault(require("path"));
const schemaToTs_1 = require("./schemaToTs");
const lodash_1 = __importDefault(require("lodash"));
const commander_1 = require("commander");
const debug_1 = __importDefault(require("debug"));
const log = (0, debug_1.default)('contract-compiler');
const generate = async (argv) => {
    log('argv', argv);
    const contractPath = argv.src;
    const outputDir = argv.out;
    const buildSchema = argv.buildSchema;
    const dir = path_1.default.join(process.cwd(), contractPath, '/contracts');
    const files = (await (0, node_recursive_directory_1.default)(dir)).filter((file) => file.endsWith('Cargo.toml'));
    const contracts = await Promise.all(files.map(async (file) => {
        const dir = path_1.default.dirname(file);
        const name = await fs_1.promises.readFile(file, 'utf8').then((data) => {
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
    }));
    if (buildSchema) {
        for (const contract of contracts) {
            await new Promise((r, rj) => (0, child_process_1.exec)('cargo schema', { cwd: contract.dir }, (err, stdout, stderr) => {
                if (err) {
                    console.error(err);
                    rj(err);
                }
                else {
                    console.log(stdout);
                    console.error(stderr);
                    r(true);
                }
            }));
        }
    }
    const contractsForCodegen = (await Promise.all(contracts.map(async (contract) => {
        //check if schema exists
        const schemaPath = path_1.default.join(contract.dir, `/schema/${contract.name}.json`);
        const schemaExists = await fs_1.promises
            .access(schemaPath)
            .then(() => true)
            .catch(() => false);
        return (schemaExists && {
            name: contract.name,
            filePath: schemaPath,
        });
    }))).filter(Boolean);
    await fs_1.promises.mkdir(outputDir, { recursive: true });
    await Promise.all(contractsForCodegen.map(async (contract) => {
        try {
            await (0, schemaToTs_1.schemaToTs)(contract.filePath, contract.name, outputDir);
        }
        catch (e) {
            console.error(`Error while processing ${contract.name}: ${e}`);
            console.error(e.stack);
        }
    }));
    await fs_1.promises.writeFile(path_1.default.join(outputDir, 'index.ts'), contractsForCodegen
        .map((contract, i) => `import * as _${i} from './${lodash_1.default.camelCase(contract.name)}';\n` +
        `export const ${lodash_1.default.upperFirst(lodash_1.default.camelCase(contract.name))} = _${i};\n`)
        .join(`\n`));
    console.log('🎉 Done!');
};
exports.generate = generate;
if (require.main === module) {
    const program = new commander_1.Command();
    program
        .requiredOption('-s, --src <path>', 'Path to contracts project')
        .requiredOption('-o, --out <path>', 'Path to output')
        .option('-b, --buildSchema', 'Build schema before codegen', false);
    program.parse();
    const argv = program.opts();
    generate(argv);
}
