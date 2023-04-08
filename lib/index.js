#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ts_codegen_1 = __importDefault(require("@cosmwasm/ts-codegen"));
const cli_argument_parser_1 = require("cli-argument-parser");
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const node_recursive_directory_1 = __importDefault(require("node-recursive-directory"));
const path_1 = __importDefault(require("path"));
(async () => {
    const contractPath = cli_argument_parser_1.cliArguments.src;
    if (!contractPath) {
        throw new Error('Contract path is not defined');
    }
    const outputDir = cli_argument_parser_1.cliArguments.out;
    if (!outputDir) {
        throw new Error('Output path is not defined');
    }
    const scope = cli_argument_parser_1.cliArguments.scope;
    if (!scope) {
        throw new Error('Scope is not defined');
    }
    const buildSchema = cli_argument_parser_1.cliArguments.buildSchema === 'false' ? false : true;
    const dir = path_1.default.join(process.cwd(), contractPath, '/contracts');
    const files = (await (0, node_recursive_directory_1.default)(dir)).filter((file) => file.endsWith('Cargo.toml'));
    const contracts = files.map((file) => ({
        dir: path_1.default.dirname(file),
        name: path_1.default.basename(path_1.default.dirname(file)),
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
    const contractsForCodegen = await Promise.all(contracts.map(async (contract) => {
        //check if schema exists
        const schemaPath = path_1.default.join(contract.dir, '/schema/raw');
        const schemaExists = await fs_1.promises
            .access(schemaPath)
            .then(() => true)
            .catch(() => false);
        return {
            name: contract.name,
            dir: schemaExists ? schemaPath : path_1.default.join(contract.dir, '/schema'),
        };
    }));
    await (0, ts_codegen_1.default)({
        contracts: contractsForCodegen,
        outPath: path_1.default.join(process.cwd(), outputDir),
        options: {
            bundle: {
                bundleFile: 'index.ts',
                scope,
            },
            types: {
                enabled: true,
            },
            client: {
                enabled: true,
            },
            messageComposer: {
                enabled: false,
            },
        },
    });
    console.log('Done');
})();
