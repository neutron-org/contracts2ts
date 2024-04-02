# Contracts2TS

Contracts2TS is a command line tool that helps you generate TypeScript code for CosmWasm smart contracts from their Rust source code. The generated code includes TypeScript types, clients, and other utilities to interact with the smart contracts.

### Important Note

Make sure you have your schemas generated with write_api marcos

## Installation

You can install Contracts2TS globally using npm:

```
npm install -g @neutron-org/contracts2ts
```

## Usage

To generate TypeScript code for your smart contracts, run the following command:

```
contracts2ts --src=<path to contracts> --out=<path to output>
```

### NPX Usage

If you don't want to install the package globally, you can use `npx` to run the command:

```
npx @neutron-org/contracts2ts --src <path to contracts> --out <path to output>
```

### Arguments

- `--src`: The path to the contracts directory.
- `--out`: The path to the output directory where the generated TypeScript code will be saved.

### Example

```
contracts2ts --src=./neutron-dao --out=./dao.ts
```

This command will generate TypeScript code for the smart contracts located in the `./neutron-dao` directory and save the output in the `./dao.ts` directory.

### Using from a script

You can also use Contracts2TS from a script by importing the `generate` function:

```ts
import { generate } from '@neutron-org/contracts2ts';

generate({
  src: '../',
  out: './src/generated/contractLib',
});
```

## How it works

The script does the following:

1. Validates the command line arguments.
2. Finds all the smart contract directories by searching for `Cargo.toml` files.
3. Executes `cargo schema` for each smart contract to generate schema files.
4. Generates TypeScript code using `@cosmwasm/ts-codegen` for each smart contract.

## Troubleshooting

If you encounter any issues or errors, make sure your smart contract directories have the necessary `Cargo.toml` and schema files. If the schema files are missing or not up-to-date, you can run `cargo schema` manually in each smart contract directory to generate them.
