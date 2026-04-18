import { z } from "zod";

import { publicProcedure, router } from "../init";

/**
 * 疎通確認用。引数 `name` を受けて「pong: <name>」を返すため Zod バリデーションの動作例になる。
 */
export const pingRouter = router({
  ping: publicProcedure
    .input(
      z
        .object({
          name: z.string().min(1).max(50).optional(),
        })
        .optional(),
    )
    .query(({ input }) => {
      if (input?.name) {
        return { message: `pong: ${input.name}` as const };
      }
      return { message: "pong" as const };
    }),
});
