{
  description = "Auckland Reuse Finder - dev shell (Node.js pinned via nix develop, no system-level nix config touched)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems f;
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
            ];

            shellHook = ''
              echo "Auckland Reuse Finder dev shell: node $(node --version), npm $(npm --version)"
            '';
          };
        }
      );
    };
}
