/**
 * Util function used to determine if a given error is an sql error
 * @param error Error to be checked
 * @returns The error as type any if it is an sql error, undefined if is not
 */
function getSqlError(error: unknown) {
    return (
        error instanceof Error && 'code' in error
        ? error as any 
        : undefined
    )
}

export { getSqlError };