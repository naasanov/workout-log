import { Response } from "express";
import { isValid, parseISO } from "date-fns";

/**
 * Validates a conventional mySql integer id. If provided a `Response` object, 
 * sends the status and message in the `output` object if provided. Otherwise,
 * sends status of 400 and message of "Request parameter id must be a positive integer".
 * If a `Response` object is not provided, simply returns a boolean.
 * @param id 
 * @param res The `Response` object of the current request
 * @param output An array of length two, with the first element being the status code, 
 * and the second element being the message
 * @returns A boolean stating if the id is valid or not
*/
function validateId(id: string, res?: Response, output?: [number, string]): boolean {
    const parsed = Number(id);
    const validInt = (
        /^\d+$/.test(id)
        && Number.isSafeInteger(parsed)
        && parsed >= 1
    )
    if (!validInt) {
        if (res) {
            const fallback: [number, string] = [400, "Request parameter id must be a positive integer"];
            const [status, message] = output ?? fallback;
            res.status(status).json({ message });
        }
        return false;
    }
    return true;
}

/**
 * Validates the provided label for sections, movements, and variations. Checks if 
 * the label is null/undefined, if it is a string, and if it is shorter than 50 characters.
 * If a response object is provided, sends a json message object describing the issue with
 * a status of 400. Otherwise, just returns the boolean.
 * @param label 
 * @param res `Response` object of the current request
 * @returns A boolean that states whether the provided label is valid
 */
function validateLabel(label: any, res?: Response): boolean {
    let message: string;
    if (label === null || label === undefined) {
        message = "Request body must include a non-null label";
    }
    else if (!(typeof label === 'string' || label instanceof String)) {
        message = "Label must be a string";
    }
    else if (label.length > 50) {
        message = "Label must not exceed 50 characters";
    }
    else {
        return true;
    }
    res?.status(400).json({ message });
    return false
}

/**
 * Validation function meant to be used in variation endpoints. This function does not check for present values, only validates those that are present.
 * @param body Request body containing any combination of the fields pertaining to variation (label, weight, reps, date)
 * @param res Optionally include the Response object to automatically send an error response upon detection of invalid data
 * @returns A boolean describing whether the request body is valid or not
*/
function validateVariation(body: any, res?: Response) {
    if (Object.keys(body).length === 0) {
        res?.status(400).json({ message: "Request body cannot be empty" });
        return false;
    }
    
    const { label, weight, reps, date } = body;
    if (label !== undefined && !validateLabel(label, res)) {
        return false;
    }
    let message: string = 'Error(s):\n';
    let valid = true;
    if (weight !== undefined && !(typeof weight === 'number' && Number.isFinite(weight) && weight >= 0)) {
        message += "Weight must be a valid non-negative number\n";
        valid = false;
    }
    if (reps !== undefined && !(typeof reps === 'number' && Number.isSafeInteger(reps) && reps >= 0)) {
        message += "Reps must be a valid non-negative integer\n";
        valid = false;
    }
    if (date !== undefined && !isValidISO(date)) {
        message += "Date field must be a ISO 8601 formatted date string\n";
        valid = false;
    }
    if (!valid) res?.status(400).json({ message });
    return valid;
}

function isValidISO(date: string) {
    return isValid(parseISO(date));
}

export { validateId, validateLabel, isValidISO, validateVariation };