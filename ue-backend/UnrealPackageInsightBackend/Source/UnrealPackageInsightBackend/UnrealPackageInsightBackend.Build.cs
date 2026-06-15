using System.IO;
using UnrealBuildTool;

public class UnrealPackageInsightBackend : ModuleRules
{
	public UnrealPackageInsightBackend(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PrivateIncludePaths.AddRange(
			new string[]
			{
				ResolveGeneratedCppIncludePath(ModuleDirectory)
			}
		);

		AddEngineThirdPartyPrivateStaticDependencies(Target, "Flatbuffers");

		PublicDependencyModuleNames.AddRange(
			new string[]
			{
				"Core"
			}
		);
	}

	private static string ResolveGeneratedCppIncludePath(string ModuleDirectory)
	{
		string RelativeGeneratedPath = Path.Combine("node-shell", "packages", "protocol", "generated", "cpp");
		string RepoRootFromEnv = System.Environment.GetEnvironmentVariable("UPI_REPO_ROOT");

		if (!string.IsNullOrEmpty(RepoRootFromEnv))
		{
			string Candidate = Path.GetFullPath(Path.Combine(RepoRootFromEnv, RelativeGeneratedPath));
			if (Directory.Exists(Candidate))
			{
				return Candidate;
			}
		}

		string FoundPath = FindGeneratedCppIncludePath(Directory.GetCurrentDirectory(), RelativeGeneratedPath);
		if (!string.IsNullOrEmpty(FoundPath))
		{
			return FoundPath;
		}

		FoundPath = FindGeneratedCppIncludePath(ModuleDirectory, RelativeGeneratedPath);
		if (!string.IsNullOrEmpty(FoundPath))
		{
			return FoundPath;
		}

		throw new BuildException("Unable to find generated protocol C++ includes at node-shell/packages/protocol/generated/cpp. Run the UE backend build from the UnrealPackageInsight repo root or set UPI_REPO_ROOT to the repo root.");
	}

	private static string FindGeneratedCppIncludePath(string StartDirectory, string RelativeGeneratedPath)
	{
		DirectoryInfo DirectoryToSearch = new DirectoryInfo(Path.GetFullPath(StartDirectory));
		while (DirectoryToSearch != null)
		{
			string Candidate = Path.Combine(DirectoryToSearch.FullName, RelativeGeneratedPath);
			if (Directory.Exists(Candidate))
			{
				return Candidate;
			}

			DirectoryToSearch = DirectoryToSearch.Parent;
		}

		return null;
	}
}
