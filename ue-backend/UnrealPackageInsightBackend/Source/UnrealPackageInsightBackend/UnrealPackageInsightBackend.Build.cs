using System.IO;
using UnrealBuildTool;

public class UnrealPackageInsightBackend : ModuleRules
{
	public UnrealPackageInsightBackend(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		string[] GeneratedCppIncludePathCandidates = new string[]
		{
			Path.GetFullPath(Path.Combine(ModuleDirectory, "..", "..", "..", "..", "node-shell", "packages", "protocol", "generated", "cpp")),
			Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "node-shell", "packages", "protocol", "generated", "cpp")),
			Path.GetFullPath(Path.Combine(ModuleDirectory, "..", "..", "..", "..", "..", "..", "..", "UnrealPackageInsight", ".worktrees", "project-architecture", "node-shell", "packages", "protocol", "generated", "cpp")),
			Path.GetFullPath(Path.Combine(ModuleDirectory, "..", "..", "..", "..", "..", "..", "..", "UnrealPackageInsight", "node-shell", "packages", "protocol", "generated", "cpp"))
		};

		string GeneratedCppIncludePath = GeneratedCppIncludePathCandidates[0];
		foreach (string Candidate in GeneratedCppIncludePathCandidates)
		{
			if (Directory.Exists(Candidate))
			{
				GeneratedCppIncludePath = Candidate;
				break;
			}
		}

		PrivateIncludePaths.AddRange(
			new string[]
			{
				GeneratedCppIncludePath,
				Path.Combine(Target.UEThirdPartySourceDirectory, "flatbuffers", "flatbuffers-24.3.25", "include")
			}
		);

		PublicDependencyModuleNames.AddRange(
			new string[]
			{
				"Core"
			}
		);
	}
}
