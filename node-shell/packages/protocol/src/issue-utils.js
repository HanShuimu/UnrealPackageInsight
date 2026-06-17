function readIssue(issue) {
  return {
    severity: issue.severity(),
    code: issue.code() || '',
    message: issue.message() || '',
  };
}

function hasIssueCode(response, suffixOrCode) {
  const issues = response.issues || [];
  return issues.some((issue) => {
    const code = issue.code || '';
    return code === suffixOrCode || code.endsWith(suffixOrCode);
  });
}

module.exports = {
  readIssue,
  hasIssueCode,
};
