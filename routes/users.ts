import { Router } from "express";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from '../database';
import handleSqlError from '../utils/handleSqlError';
import { authenticateToken } from "./auth";
import { User } from "../types";
import { tabPreferencesSchema } from "../schemas/tabPreferences";
import { getTabPreferences, putTabPreferences } from "../services/tabPreferences";
import { agentInstructionsSchema } from "../shared/agentInstructions";

const router = Router();
router.use(authenticateToken);

// #110: customizable tabs — ordered list of enabled top-level tabs (element[0] is
// the user's homepage). Missing row → [] → client shows the new-account empty state.
router.get('/tab-preferences', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    try {
        const data = await getTabPreferences(uuid);
        return res.status(200).json({ data, message: "Successfully retrieved tab preferences" });
    } catch (error) {
        return handleSqlError(error, res);
    }
});

router.put('/tab-preferences', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const parsed = tabPreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Invalid request body' });
    }
    try {
        const data = await putTabPreferences(uuid, parsed.data.enabledTabs);
        return res.status(200).json({ data, message: "Tab preferences saved" });
    } catch (error) {
        return handleSqlError(error, res);
    }
});

// #382: per-user free-text instructions folded into the agent's system
// prompt (see services/agent/prompt/userInstructions.ts).
router.get('/agent-instructions', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    let data: RowDataPacket;
    try {
        [[data]] = await pool.query<RowDataPacket[]>(`
            SELECT agent_instructions
            FROM users
            WHERE user_uuid = UUID_TO_BIN(?);
        `, [uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }
    return res.status(200).json({
        data: { instructions: data?.agent_instructions ?? null },
        message: "Successfully retrieved agent instructions",
    });
});

router.put('/agent-instructions', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const parsed = agentInstructionsSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Invalid request body' });
    }
    // A trimmed-empty value (blank or whitespace-only) is stored as NULL,
    // meaning no instructions are set, rather than an empty string.
    const instructions = parsed.data.instructions.length > 0 ? parsed.data.instructions : null;
    try {
        await pool.query<ResultSetHeader>(`
            UPDATE users
            SET agent_instructions = ?
            WHERE user_uuid = UUID_TO_BIN(?);
        `, [instructions, uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }
    return res.status(200).json({
        data: { instructions },
        message: "Agent instructions saved",
    });
});

// Read
router.get('/', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;

    let data: RowDataPacket;
    try {
        [[data]] = await pool.query<RowDataPacket[]>(`
            SELECT BIN_TO_UUID(user_uuid) AS uuid, email
            FROM users
            WHERE user_uuid = UUID_TO_BIN(?);
        `, [uuid])
    } catch (error) {
        return handleSqlError(error, res)
    }

    if (!data) {
        return res.status(404).json({ message: `No user found with uuid ${uuid}` });
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved user with uuid ${uuid}`
    })
})

export default router;
