import { Router } from 'express';
import handleSqlError from '../utils/handleSqlError';
import { validateLabel, validateId, validateSection } from '../utils/validation';
import SqlError from '../utils/sqlErrors';
const { WRONG_TYPE_ERROR, NO_REFERENCE_ERROR, TOO_LONG_ERROR, WRONG_VALUE_ERROR } = SqlError;
import { authenticateToken } from "./auth";
import { User } from '../types';
import * as store from '../services/workouts';

const router = Router();
router.use(authenticateToken);

// Sections are the top-level owned resource, so every route below scopes its
// query by user_uuid directly rather than through a join. Handlers report a
// 404 rather than a 403 for another user's section to keep ids unenumerable.

// POST
router.post('/', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const label = req.body.label;
    if (!validateLabel(label, res)) return;

    let sectionId: number;
    try {
        sectionId = await store.createSection(uuid, label);
    }
    catch (error) {
        return handleSqlError(error, res, {
            [WRONG_TYPE_ERROR]: [400, "Request parameter must be a 36 character, hyphen separated uuid"],
            [NO_REFERENCE_ERROR]: [404, `User with uuid ${uuid} not found`],
            [TOO_LONG_ERROR]: [400, `Label must not exceed 50 characters`]
        })
    }

    res.status(201).json({
        data: { sectionId },
        message: `Successfullly created section with id ${sectionId}`
    })
})

// GET many
router.get('/user', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;

    try {
        if (!await store.userExists(uuid)) {
            return res.status(404).json({ message: `User with id ${uuid} does not exist` });
        }
    } catch (error) {
        return handleSqlError(error, res, {
            [WRONG_TYPE_ERROR]: [400, "Request parameter must be a 36 character, hyphen separated uuid"]
        });
    }

    let data: store.SectionSummary[];
    try {
        data = await store.listSectionsForUser(uuid);
    }
    catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved all sections for user with id ${uuid}`
    })
})

// GET one
router.get('/section/:sectionId', async (req, res): Promise<any> => {
    const sectionId = req.params.sectionId;
    if (!validateId(sectionId, res)) return;

    const { uuid }: User = res.locals.user;
    let data: store.SectionDetail | null;
    try {
        data = await store.getSectionById(uuid, sectionId);
    }
    catch (error) {
        return handleSqlError(error, res);
    }

    if (!data) {
        return res.status(404).json({ message: `Section with id ${sectionId} not found` });
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved section with id ${sectionId}`
    })
})

// PATCH
router.patch('/:sectionId', async (req, res): Promise<any> => {
    const sectionId = req.params.sectionId;
    if (!validateId(sectionId, res)) return;

    const allowedFields = ['label', 'is_open'];
    const invalidFields = Object.keys(req.body).filter(key => !allowedFields.includes(key));
    if (invalidFields.length > 0) {
        return res.status(400).json({
            message: `Invalid fields: ${invalidFields.join(', ')}. Allowed fields are: ${allowedFields.join(', ')}.`
        });
    }
    if (!validateSection(req.body, res)) return;

    const { uuid }: User = res.locals.user;
    let updated: boolean;
    try {
        updated = await store.updateSection(uuid, sectionId, req.body);
    } catch (error) {
        return handleSqlError(error, res, {
            [WRONG_VALUE_ERROR]: [400, "Request parameter section id must be an integer"]
        })
    }

    if (!updated) {
        return res.status(404).json({ message: `No section with id ${sectionId}` });
    }

    res.status(200).json({ message: `Successfully updated section with id ${sectionId}` });
})

// DELETE
router.delete('/:sectionId', async (req, res): Promise<any> => {
    const sectionId = req.params.sectionId;
    if (!validateId(sectionId, res)) return;

    const { uuid }: User = res.locals.user;
    let deleted: boolean;
    try {
        deleted = await store.deleteSection(uuid, sectionId);
    } catch (error) {
        return handleSqlError(error, res, {
            [WRONG_VALUE_ERROR]: [400, "Request parameter section id must be an integer"]
        });
    }

    if (!deleted) {
        return res.status(404).json({ message: `No section found with id ${sectionId}` });
    }

    res.status(200).json({ message: `Successfully deleted section with id ${sectionId}` });
})

export default router;
