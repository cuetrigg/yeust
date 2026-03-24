# In-Memory Example

This example shows the smallest useful `yeust` setup with `MemoryEmulsifier`.

Run it:

```bash
cd examples/in-memory-chat
bun run dev
```

Open `http://localhost:3001` in a few tabs, join the same pocket, and test:

- local pocket membership
- in-process broadcast fanout
- acknowledgement handling without Redis

Key usage is in `examples/in-memory-chat/index.ts`.
