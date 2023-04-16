"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.schemaToTs = void 0;
const json_schema_to_typescript_1 = require("json-schema-to-typescript");
const fs_1 = require("fs");
const lodash_1 = __importDefault(require("lodash"));
const path_1 = __importDefault(require("path"));
const json_schema_ref_parser_1 = __importDefault(require("@apidevtools/json-schema-ref-parser"));
const debug_1 = __importDefault(require("debug"));
const log = (0, debug_1.default)('schemaToTs');
const fixEnum = (o) => {
    if (o.type === 'string' && o.enum && o.enum.length === 0) {
        o.type = 'object';
        delete o.enum;
    }
    return o;
};
const fixEmptyEnums = (o) => {
    for (const [k, dVal] of Object.entries(o)) {
        fixEnum(dVal);
    }
    return o;
};
const schemaToTs = async (filePath, scope, outDir) => {
    log('schemaToTs', filePath, scope, outDir);
    const file = JSON.parse(await fs_1.promises.readFile(filePath, 'utf-8'));
    let importOut = `import { CosmWasmClient, SigningCosmWasmClient, ExecuteResult } from "@cosmjs/cosmwasm-stargate"; 
import { StdFee } from "@cosmjs/amino";
`;
    let out = ``;
    let typesOut = '';
    const queryMap = {};
    let hasCoin = false;
    let definitions = {};
    const globalSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: `${scope}Schema`,
        type: 'object',
        required: [],
        properties: {},
    };
    if (file.responses && Object.keys(file.responses).length) {
        globalSchema.required.push('responses');
        globalSchema.properties.responses = {
            type: 'object',
            oneOf: [],
        };
        for (const [fnName, value] of Object.entries(file.responses)) {
            const title = value.title;
            const newTitle = lodash_1.default.upperFirst((title.startsWith('Array_of_')
                ? title.replace(/^Array_of_/, '') + '[]'
                : title)
                .replace(/Tuple_of/, 'TupleOf')
                .replace(/_and_/, 'And_'));
            log(value.title);
            fixEnum(value);
            if (value.title === 'Coin') {
                hasCoin = true;
            }
            if (value.definitions) {
                definitions = { ...definitions, ...value.definitions };
            }
            value.title = newTitle;
            globalSchema.properties.responses.oneOf.push(value);
            queryMap[fnName] = newTitle;
        }
    }
    out += `
export class Client {
  private readonly client: CosmWasmClient | SigningCosmWasmClient;
  contractAddress: string;
  constructor(client: CosmWasmClient | SigningCosmWasmClient, contractAddress: string) {
    this.client = client;
    this.contractAddress = contractAddress;
  }
  mustBeSigningClient() {
    return new Error("This client is not a SigningCosmWasmClient");
  }
`;
    if (file.query && file.query.oneOf) {
        globalSchema.properties.query = {
            type: 'object',
            oneOf: [],
        };
        definitions = { ...definitions, ...file.query.definitions };
        let wasRequired = false;
        for (const query of file.query.oneOf) {
            const queryName = query.required[0];
            const outType = queryMap[queryName];
            const inType = query.properties[queryName];
            log('generating query', queryName);
            if (inType.required) {
                wasRequired = true;
                const compType = {
                    ...inType,
                    title: `${queryName}Args`,
                };
                globalSchema.properties.query.oneOf.push(compType);
                out += `  query${lodash_1.default.upperFirst(lodash_1.default.camelCase(queryName))} = async(args: ${lodash_1.default.upperFirst(lodash_1.default.camelCase(queryName))}Args): Promise<${outType}> => {
    return this.client.queryContractSmart(this.contractAddress, { ${queryName}: args });
  }
`;
            }
            else {
                out += `  query${lodash_1.default.upperFirst(lodash_1.default.camelCase(queryName))} = async(): Promise<${outType}> => {
    return this.client.queryContractSmart(this.contractAddress, { ${queryName}: {} });
  }
`;
            }
        }
        if (!wasRequired) {
            delete globalSchema.properties.query;
        }
        else {
            globalSchema.required.push('query');
        }
    }
    log('query compiled');
    if (file.execute && file.execute.oneOf) {
        log('adding execute');
        definitions = { ...definitions, ...file.execute.definitions };
        globalSchema.properties.execute = {
            type: 'object',
            oneOf: [],
        };
        let wasRequired = false;
        for (const execute of file.execute.oneOf) {
            const executeName = execute.required[0];
            const inType = execute.properties[executeName];
            if (inType.required) {
                wasRequired = true;
                const compType = {
                    ...inType,
                    title: `${executeName}Args`,
                };
                globalSchema.properties.execute.oneOf.push(compType);
                out += `  ${lodash_1.default.camelCase(executeName)} = async(sender:string, args: ${lodash_1.default.upperFirst(lodash_1.default.camelCase(executeName))}Args, fee?: number | StdFee | "auto", memo?: string, funds?: Coin[]): Promise<ExecuteResult> =>  {
    if (!(this.client instanceof SigningCosmWasmClient)) { throw this.mustBeSigningClient(); }
    return this.client.execute(sender, this.contractAddress, { ${executeName}: args }, fee || "auto", memo, funds);
  }
`;
            }
            else {
                out += `  ${lodash_1.default.camelCase(executeName)} = async(sender: string, fee?: number | StdFee | "auto", memo?: string, funds?: Coin[]): Promise<ExecuteResult> =>  {
    if (!(this.client instanceof SigningCosmWasmClient)) { throw this.mustBeSigningClient(); }
    return this.client.execute(sender, this.contractAddress, { ${executeName}: {} }, fee || "auto", memo, funds);
  }
`;
            }
        }
        if (!wasRequired) {
            delete globalSchema.properties.execute;
        }
        else {
            globalSchema.required.push('execute');
        }
    }
    out += `}
`;
    globalSchema.definitions = fixEmptyEnums(definitions);
    if (!hasCoin && !globalSchema.definitions.Coin) {
        importOut += `import { Coin } from "@cosmjs/amino";
`;
    }
    const x = globalSchema;
    typesOut += await (0, json_schema_to_typescript_1.compile)((await json_schema_ref_parser_1.default.dereference(x)), 'Response', {
        bannerComment: '',
    });
    await fs_1.promises.writeFile(path_1.default.join(outDir, `${lodash_1.default.camelCase(scope)}.ts`), importOut + typesOut + out);
};
exports.schemaToTs = schemaToTs;
