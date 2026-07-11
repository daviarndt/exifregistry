/**
 * Shell completion script generation for `exifreg completion <shell>`.
 *
 * Commander does not ship completion, so we emit small, dependency-free
 * scripts that complete the subcommand names (and fall back to file
 * completion for arguments). The command list is passed in so it never
 * drifts from the actual program.
 */

export type Shell = "bash" | "zsh" | "fish";

export function parseShell(input: string): Shell {
  const cleaned = input.trim().toLowerCase();
  if (cleaned === "bash" || cleaned === "zsh" || cleaned === "fish") {
    return cleaned;
  }
  throw new Error(`Unsupported shell "${input}". Use bash, zsh or fish.`);
}

export function completionScript(shell: Shell, commands: string[]): string {
  const list = commands.join(" ");
  if (shell === "bash") {
    return `# exifreg bash completion. Add to your shell with:
#   exifreg completion bash > /usr/local/etc/bash_completion.d/exifreg
# or append to ~/.bashrc:  source <(exifreg completion bash)
_exifreg() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${list}" -- "$cur") )
  else
    COMPREPLY=( $(compgen -f -- "$cur") )
  fi
}
complete -o default -F _exifreg exifreg exifregistry
`;
  }
  if (shell === "zsh") {
    return `#compdef exifreg exifregistry
# exifreg zsh completion. Add to your shell with:
#   exifreg completion zsh > "\${fpath[1]}/_exifreg"
# or append to ~/.zshrc:  source <(exifreg completion zsh)
_exifreg() {
  local -a commands
  commands=(${commands.map((c) => `'${c}'`).join(" ")})
  if (( CURRENT == 2 )); then
    _describe 'command' commands
  else
    _files
  fi
}
compdef _exifreg exifreg exifregistry
`;
  }
  // fish
  return `# exifreg fish completion. Add to your shell with:
#   exifreg completion fish > ~/.config/fish/completions/exifreg.fish
${commands
  .map(
    (c) =>
      `complete -c exifreg -n __fish_use_subcommand -a ${c}\ncomplete -c exifregistry -n __fish_use_subcommand -a ${c}`,
  )
  .join("\n")}
`;
}
