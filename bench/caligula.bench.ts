import { filterCss } from "caligula";
import { group, task } from "ostia";
import { checkWorkload, WORKLOADS } from "./workloads";

const groups = Map.groupBy(WORKLOADS, (workload) => workload.group);
for (const [name, workloads] of groups) {
  group(name, () => {
    for (const workload of workloads) {
      checkWorkload(filterCss, workload);
      const { css, options } = workload;
      task(workload.name, () => {
        filterCss(css, options);
      });
    }
  });
}
