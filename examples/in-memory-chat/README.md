# In-Memory React Example

This app was created with `bun init --react` and then wired to `MemoryEmulsifier`.

Run it:

```bash
cd examples/in-memory-chat
bun dev
```

Open `http://localhost:3001` in multiple tabs to test:

- pocket joins and leaves
- single-process broadcast fanout
- local acknowledgement handling

The server entry is `examples/in-memory-chat/src/index.ts` and the React UI lives in `examples/in-memory-chat/src/App.tsx`.
