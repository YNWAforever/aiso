import { Socket } from 'node:net'
import { syncBuiltinESMExports } from 'node:module'

const denied = () => { throw new Error('ISOLATED_RUNTIME_OUTBOUND_DISABLED') }
// Test process only. Incoming HTTP and process IPC remain available.
Socket.prototype.connect = denied
globalThis.fetch = denied
syncBuiltinESMExports()
