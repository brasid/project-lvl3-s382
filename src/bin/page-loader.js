#!/usr/bin/env node

import program from 'commander';
import pageLoader from '..';
import { version } from '../../package.json';
import ProjectError from '../ProjectError';

program
  .version(version, '-v, --version')
  .arguments('<address>')
  .option('-o, --output [path]', 'Output path', process.cwd())
  .description('Downloads page to your local machine with provided path')
  .action(address => pageLoader(address, program.output)
    .catch((error) => {
      console.error(new ProjectError(error));
      process.exit(1);
    }));

program.parse(process.argv);
