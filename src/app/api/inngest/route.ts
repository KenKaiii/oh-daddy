import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { processComment } from "@/inngest/functions/process-comment";

export const { GET, POST, PUT } = serve({
	client: inngest,
	functions: [processComment],
});
