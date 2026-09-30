import { filterCss } from "caligula";
import { group, task } from "ostia";
import { checkWorkload, WORKLOADS } from "./workloads";

const groups = Map.groupBy(WORKLOADS, (workload) => workload.group);
for (const [name, workloads] of groups) {
  group(name, () => {
    for (const workload of workloads) {
      // Its garbage would hide the task's peak from `--peak-mem`.
      if (!process.env.OSTIA_PEAK_MEM) checkWorkload(filterCss, workload);
      const { css, options, warmup } = workload;
      task(workload.name, () => filterCss(css, options), {
        before:
          warmup === undefined
            ? undefined
            : () => {
                for (let i = 0; i < 30; i++) filterCss(warmup, options);
              },
      });
    }
  });
}
