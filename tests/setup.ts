/**
 * Global test setup: wire the filesystem registry loader into the provider so
 * any test that invokes a tool handler (which reads the registry via the
 * provider) works without each test bootstrapping it. Tests that import the fs
 * loader directly are unaffected.
 */
import { bootstrapNodeRegistry } from "../src/registry/nodeRegistryBootstrap.js";

bootstrapNodeRegistry();
