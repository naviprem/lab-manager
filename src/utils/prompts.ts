import * as readline from "readline";
import chalk from "chalk";

/**
 * Simple yes/no confirmation prompt
 */
export async function confirm(
  message: string,
  defaultValue = false
): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const defaultText = defaultValue ? "Y/n" : "y/N";
  const prompt = `${message} [${defaultText}]: `;

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();

      const normalized = answer.trim().toLowerCase();
      if (normalized === "") {
        resolve(defaultValue);
      } else if (normalized === "y" || normalized === "yes") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

/**
 * Destructive confirmation requiring typing a specific value
 */
export async function confirmDestructive(
  message: string,
  confirmationValue: string
): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = `${message}\nType "${chalk.yellow(confirmationValue)}" to confirm: `;

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim() === confirmationValue);
    });
  });
}

/**
 * Display a formatted info box
 */
export function infoBox(title: string, lines: string[]): void {
  const maxLength = Math.max(
    title.length,
    ...lines.map((line) => line.length)
  );
  const width = maxLength + 4;
  const border = "═".repeat(width);

  console.log(chalk.blue(`\n╭${border}╮`));
  console.log(chalk.blue(`│  ${title.padEnd(maxLength)}  │`));
  console.log(chalk.blue(`├${border}┤`));

  for (const line of lines) {
    console.log(chalk.blue(`│  ${line.padEnd(maxLength)}  │`));
  }

  console.log(chalk.blue(`╰${border}╯\n`));
}
