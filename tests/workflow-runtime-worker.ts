import type {Bindings} from '../src/index';
import {ensureDao} from '../src/db';
import {CertificateWorkflow, queueOrder, readOrderWork} from '../src/order-workflow';

const uuid = 'fixture-background-order';

export class CertificateWorkflowProbe extends CertificateWorkflow {
    protected async advance(id: string) {
        const dao = await ensureDao(this.env);
        const row = (await dao.getApply(id))!;
        const flag = Math.min(5, Number(row.flag) + 1);
        await dao.updateApply(id, {flag, text: `Fixture stage ${flag}`, list: JSON.stringify([
            {name: 'example.com', type: 'dns-api', flag: flag >= 4 ? 4 : flag,
                dnsStatus: flag >= 4 ? 'cleaned' : 'waiting_propagation'},
        ])});
        return [];
    }
}

export default {
    async fetch(request: Request, env: Bindings) {
        const path = new URL(request.url).pathname;
        if (path === '/seed' && request.method === 'POST') {
            const {statements} = await request.json() as {statements: string[]};
            await env.DB_CF!.batch(statements.map((statement) => env.DB_CF!.prepare(statement)));
            const dao = await ensureDao(env);
            if (!await dao.getUser('fixture@example.com')) await dao.insertUser({mail: 'fixture@example.com', flag: '1', is_admin: 0, quota: -1});
            const row = {uuid, mail: 'fixture@example.com', sign: null, type: null, auto: 0, flag: 0, time: Date.now(), next: Date.now() + 60000,
                main: '{}', list: JSON.stringify([{name: 'example.com', type: 'dns-api', flag: 0}]), data: '', cert: '', keys: '', text: 'Queued'};
            if (await dao.getApply(uuid)) await dao.updateApply(uuid, row); else await dao.insertApply(row);
            await queueOrder(env, uuid);
            return Response.json({accepted: true, uuid}, {status: 202});
        }
        if (path === '/status') {
            const dao = await ensureDao(env);
            const row = await dao.getApply(uuid);
            return Response.json({flag: row?.flag, work: await readOrderWork(dao, uuid)});
        }
        return new Response('Not found', {status: 404});
    },
};