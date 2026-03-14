#!/usr/bin/env node

import { require as tsxRequire } from "tsx/cjs/api";

tsxRequire("../cli/gatekeeper.ts", import.meta.url);
