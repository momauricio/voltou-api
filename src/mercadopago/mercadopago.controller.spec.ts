import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CheckoutService } from '../checkout/checkout.service';
import { MercadoPagoController } from './mercadopago.controller';
import { MercadoPagoService } from './mercadopago.service';

describe('MercadoPago webhook (http)', () => {
  let app: INestApplication;
  const mpService = {
    health: () => ({ module: 'mercadopago', status: 'ok' }),
    handleWebhook: jest.fn(),
  };
  const checkoutService = {
    markPaid: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MercadoPagoController],
      providers: [
        { provide: MercadoPagoService, useValue: mpService },
        { provide: CheckoutService, useValue: checkoutService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls markPaid internally after webhook verifies an approved payment', async () => {
    mpService.handleWebhook.mockResolvedValue({
      checkoutId: 'chk-1',
      status: 'approved',
      paymentId: 'pay-99',
    });
    checkoutService.markPaid.mockResolvedValue({ id: 'chk-1', status: 'paid' });

    await request(app.getHttpServer())
      .post('/mercadopago/webhook')
      .send({ type: 'payment', data: { id: 'pay-99' } })
      .expect(201);

    expect(checkoutService.markPaid).toHaveBeenCalledWith('chk-1', undefined, {
      mpPaymentId: 'pay-99',
    });
  });

  it('does not call markPaid when webhook ignores a non-approved payment', async () => {
    mpService.handleWebhook.mockResolvedValue({
      ignored: true,
      reason: 'status=pending',
      checkoutId: 'chk-1',
      paymentId: 'pay-99',
    });

    await request(app.getHttpServer())
      .post('/mercadopago/webhook')
      .send({ type: 'payment', data: { id: 'pay-99' } })
      .expect(201);

    expect(checkoutService.markPaid).not.toHaveBeenCalled();
  });
});
