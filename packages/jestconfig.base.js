module.exports = {
  rootDir: 'src',
  transform: { '^.+\\.(t|j)sx?$': '@swc/jest' },
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};
