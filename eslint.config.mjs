import raycastConfig from "@raycast/eslint-config";

export default [...raycastConfig, { ignores: ["dist/**", ".test-dist/**", "raycast-env.d.ts"] }];
